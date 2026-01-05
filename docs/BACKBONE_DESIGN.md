# Backbone Design (Syllabus to Calendar)

## 1) Backbone scope
This backbone defines the core backend and processing pipeline for:
- Syllabus PDF ingestion and extraction.
- Task creation from extracted deadlines.
- Calendar generation and schedule updates.
- Risk scoring and analytics integration.

## 2) Core components
API layer:
- Auth and user context.
- File upload and syllabus endpoints.
- Task, schedule, and analytics endpoints.

Services layer:
- SyllabusService: lifecycle of syllabus files and extraction review.
- ExtractionService: PDF parsing, OCR, and item detection.
- TaskService: task CRUD and ingestion from approved items.
- SchedulingService: plan creation and recompute.
- RiskService: prediction and explanation.

Workers:
- extraction_worker: handles PDF processing and extraction.
- schedule_worker: recompute plans on task changes.
- retrain_worker: periodic ML retrain.

Storage:
- PostgreSQL for metadata, tasks, and schedules.
- Object storage for PDF files and optional parsed text.

## 3) Syllabus ingestion pipeline
Step 1: Upload
- Validate file type and size.
- Store PDF in object storage.
- Create syllabi record with status = uploaded.

Step 2: Extraction
- Extract text using a PDF parser.
- If text density is low, run OCR.
- Split by page and section headers.
- Identify candidate items using rules:
  - due|deadline|exam|quiz|project|assignment patterns
  - date parsing with locale awareness
- Score each item with a confidence value.

Step 3: Review
- Show extracted items in a review table.
- User can accept, edit, or reject each item.
- Accepted items become tasks and deadline events.

Step 4: Calendar generation
- Create or update schedule plan for the week.
- Place study blocks relative to deadlines and availability.
- Flag items with high risk or low confidence.

## 4) Data model additions
syllabi
- id, user_id, course, term
- file_name, storage_key
- status, uploaded_at

syllabus_extractions
- id, syllabus_id
- item_type, title, due_at
- confidence, source_page, raw_text
- status, created_at

Optional:
courses
- id, user_id, name, term

## 5) Calendar model
Calendar view is derived from:
- tasks.deadline_at (deadline events)
- schedule_items (study sessions)
- availability_blocks (free time grid)

No separate calendar table is required unless sharing/export is added.

## 6) API backbone (high level)
Syllabus:
- POST /api/syllabi (upload PDF)
- GET /api/syllabi/:id (status)
- GET /api/syllabi/:id/extractions
- PATCH /api/syllabi/:id/extractions/:extraction_id
- POST /api/syllabi/:id/confirm

Calendar:
- GET /api/calendar (deadlines + schedule items)
- POST /api/schedule/generate

## 7) Extraction confidence rules
Confidence inputs:
- date parse success
- keyword proximity to date
- section heading match
- repeat detection across pages

Publishing rule:
- If confidence >= 0.75, pre-check as accepted.
- Otherwise default to pending.

## 8) Failure handling
- If extraction fails, mark status = failed and expose error message.
- Allow re-run extraction with a new parser config.
- Keep raw text for audit and debugging.

## 9) Concurrency and integrity
- Use DB transactions for task creation from extractions.
- Lock schedule_plans by user and week to avoid overlaps.
- Add schedule_plan_version to prevent stale writes.

## 10) Observability
Track:
- extraction duration
- number of items extracted per syllabus
- schedule generation duration
- task creation count from syllabus

## 11) Repo backbone (suggested)
- backend/
  - controllers/
  - services/
  - repositories/
  - workers/
  - models/
- frontend/
  - pages/
  - components/
  - styles/
- shared/
  - types/
  - utils/
- docs/
