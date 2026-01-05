# Intelligent Study Planner and Performance Analyzer

## 1) Product overview
Build a web app that helps students plan study time, predicts risk of missing deadlines, and adapts schedules based on behavior. The product combines scheduling algorithms, interpretable ML, and a usability-first dashboard.

Primary value:
- Reduce missed deadlines with proactive planning and alerts.
- Make time allocation transparent and adaptable.
- Provide visual feedback that improves habits over time.

## 2) Goals and non-goals
Goals:
- Generate a weekly study plan from tasks and deadlines.
- Predict risk of missing a deadline for each task.
- Provide actionable recommendations and trend analytics.
- Keep the system interpretable and testable.
- Ingest syllabus PDFs and generate an initial calendar.

Non-goals (v1):
- Real-time collaboration between multiple users.
- Integration with external calendars or LMS systems.
- Advanced deep learning models.

## 3) Personas
1) Overloaded student: many tasks, needs prioritization and time allocation.
2) Procrastinator: misses early signals, needs reminders and risk alerts.
3) Planner: wants analytics and schedule predictability.

## 4) User journeys
Journey A: Onboarding and setup
- Create account -> add courses -> add assignments and deadlines -> set weekly availability.

Journey B: Weekly planning
- System generates a study schedule -> user adjusts -> plan locks for the week -> progress tracking.

Journey C: Risk alerts and improvements
- Risk score for each task -> targeted recommendations -> schedule adaptation.

Journey D: Syllabus import
- Upload syllabus PDF -> auto extract deadlines -> review and confirm -> calendar populated.

## 5) Functional requirements
Core:
- Task CRUD with deadlines, estimated effort, importance, and course tag.
- Availability settings (per weekday time blocks).
- Auto schedule generation based on tasks and availability.
- Risk score for each task with reason codes.
- Progress tracking and completion logging.
- Dashboard with progress, upcoming deadlines, and risk trends.
- Syllabus PDF upload, extraction, review, and calendar creation.

Admin/ops:
- Background jobs for schedule recompute and model retraining.
- Basic metrics and audit logs for schedule changes.

## 6) Non-functional requirements
- Performance: schedule generation < 1s for 200 tasks.
- Reliability: 99.5% uptime target for student use.
- Privacy: clear data boundaries by user, no sharing.
- Interpretability: ML must expose feature contributions or heuristics.

## 7) System architecture
Layered architecture with explicit boundaries:

Client (React)
  -> API Gateway (REST)
  -> Services (Scheduling, Risk, Analytics, Syllabus Ingestion)
  -> Repositories (DB access)
  -> PostgreSQL

Background workers:
- Schedule recompute worker
- ML retraining worker
- Syllabus extraction worker

Event flow (simplified):
User edits task -> API -> TaskService -> TaskRepo -> DB
  -> emits "task_changed" -> ScheduleWorker -> new plan -> DB

Syllabus upload -> API -> SyllabusService -> SyllabusRepo -> DB
  -> emits "syllabus_uploaded" -> ExtractionWorker -> extracted items -> DB
  -> user review -> Task creation -> ScheduleWorker

## 8) Data model (PostgreSQL)
Key entities and relationships:
- users 1---* tasks
- users 1---* study_sessions
- tasks 1---* task_outcomes
- users 1---* availability_blocks
- users 1---* schedule_plans
- schedule_plans 1---* schedule_items
- users 1---* syllabi
- syllabi 1---* syllabus_extractions

Proposed schema:

users
- id (pk)
- email (unique)
- name
- timezone
- created_at

tasks
- id (pk)
- user_id (fk users.id, index)
- title
- course
- deadline_at (index)
- estimated_minutes
- importance (1-5)
- status (pending, in_progress, done)
- created_at

availability_blocks
- id (pk)
- user_id (fk users.id, index)
- weekday (0-6)
- start_time
- end_time
- created_at

study_sessions
- id (pk)
- user_id (fk users.id, index)
- task_id (fk tasks.id, index)
- started_at
- duration_minutes
- created_at

task_outcomes
- id (pk)
- task_id (fk tasks.id, index)
- completed_at
- on_time (bool)
- minutes_spent
- created_at

schedule_plans
- id (pk)
- user_id (fk users.id, index)
- week_start_date (index)
- created_at

schedule_items
- id (pk)
- schedule_plan_id (fk schedule_plans.id, index)
- task_id (fk tasks.id, index)
- start_at
- end_at
- source (auto, manual)
- created_at

syllabi
- id (pk)
- user_id (fk users.id, index)
- course
- term
- file_name
- storage_key
- status (uploaded, processing, needs_review, confirmed, failed)
- uploaded_at

syllabus_extractions
- id (pk)
- syllabus_id (fk syllabi.id, index)
- item_type (assignment, exam, reading, other)
- title
- due_at
- confidence
- source_page
- raw_text
- status (pending, accepted, rejected, edited)
- created_at

Indexes:
- tasks(user_id, deadline_at)
- study_sessions(user_id, started_at)
- schedule_items(task_id, start_at)
- schedule_plans(user_id, week_start_date)
- syllabi(user_id, status)
- syllabus_extractions(syllabus_id, status)

## 9) Scheduling algorithm
Goal: assign study blocks to tasks using deadlines, effort, and priority.

Inputs:
- task list (deadline, estimated_minutes, importance)
- availability blocks (time slots)
- existing schedule plan (if recompute)

Heuristic (greedy + priority queue):
1) Expand availability into 30-minute slots.
2) Compute task priority score:
   score = w1 * urgency + w2 * importance + w3 * remaining_effort
   urgency = 1 / max(1, days_to_deadline)
3) Use a priority queue ordered by score.
4) Assign the earliest available slots to highest-priority tasks.
5) Recompute incrementally on task change:
   - only reassign slots impacted by new or modified tasks.

Optional DP variant:
- Optimize total weighted completion before deadlines.
- Use when tasks <= 40 to keep runtime manageable.

Complexity:
- Greedy: O(S log T), S = slots, T = tasks.
- Incremental recompute: O(K log T), K = impacted slots.

## 10) Risk prediction (ML)
Objective: binary classification - will a task miss deadline?

Features:
- average completion rate (past 30 days)
- time before deadline at schedule creation
- estimated_minutes
- prior missed deadlines count
- average daily study minutes

Models (interpretable):
- Logistic regression baseline.
- Decision tree for rule-like outputs.

Outputs:
- risk_score (0-1)
- reason_codes (top features contributing to risk)

Training:
- Use task_outcomes as labels.
- Retrain weekly or after N new outcomes.
- Use time-based split to avoid leakage.

Limitations:
- Data sparsity for new users.
- Correlations only, not causation.

## 11) API design (REST)
Auth:
- POST /api/auth/login
- POST /api/auth/signup

Tasks:
- GET /api/tasks
- POST /api/tasks
- PATCH /api/tasks/:id
- DELETE /api/tasks/:id

Schedule:
- POST /api/schedule/generate
- GET /api/schedule/current
- PATCH /api/schedule/items/:id

Risk:
- GET /api/risk/summary
- GET /api/risk/tasks

Analytics:
- GET /api/analytics/progress
- GET /api/analytics/trends

Syllabus:
- POST /api/syllabi
- GET /api/syllabi/:id
- GET /api/syllabi/:id/extractions
- PATCH /api/syllabi/:id/extractions/:extraction_id
- POST /api/syllabi/:id/confirm

## 12) UX and wireframe plan
Primary views:
- Dashboard: risk summary, upcoming deadlines, weekly study chart.
- Schedule: calendar-style view with draggable items.
- Tasks: list with filters and risk badges.
- Insights: trend charts and recommendations.
- Syllabus import: upload, processing state, and review list.

Wireframe notes:
- Emphasize risk labels with plain language.
- Include "Why this?" tooltips on risk scores.
- Use color sparingly for priority and risk.

## 13) Recommendations engine
Rule-based recommendations in v1:
- If risk_score > 0.7 and deadline < 5 days, prompt to add extra slots.
- If estimated_minutes > weekly availability, suggest splitting task.
- If user misses 2 deadlines in a week, suggest reducing task load.

## 14) Background jobs and concurrency
Workers:
- schedule_recompute_worker: listens for task changes.
- model_retrain_worker: runs weekly or when new labels accumulate.
- syllabus_extraction_worker: extracts items from PDFs and queues review.

Concurrency handling:
- Schedule updates use transactions with row-level locks.
- Schedule plan versioning to avoid stale overwrites.

## 15) Testing strategy
Unit tests:
- Scheduling scoring and slot assignment.
- Feature extraction for ML.
- Task and schedule repository logic.

Integration tests:
- Schedule generation with seeded tasks.
- Risk endpoint returns reasons and consistent scores.
- Syllabus upload -> extraction -> review -> task creation.

End-to-end:
- Create tasks -> generate schedule -> mark completion.

## 16) Deployment and ops
Local dev:
- Backend: Node.js or Python API server.
- DB: PostgreSQL in Docker.

CI:
- Run tests + lint on pull request.

Observability:
- Basic logs for schedule recompute and model retrain.
- Track schedule generation duration and DB query time.

## 17) Milestones
Milestone 1: Core data model + task CRUD + availability.
Milestone 2: Syllabus import + extraction + review.
Milestone 3: Scheduling algorithm + schedule view.
Milestone 4: Risk model + dashboard.
Milestone 5: Analytics + recommendations + polish.

## 18) Open questions
- How much manual schedule editing is allowed vs auto plan?
- Should we allow course-level weighting?
- What is the minimum data needed before enabling risk scores?
- What extraction accuracy is required before auto publishing to the calendar?
