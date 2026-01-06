import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const tabs = ["Dashboard", "Calendar", "Tasks", "Import"];

const baseExtractions = [];

const recommendationList = [
  "Add 60 more minutes this week for CHEM 140 to reduce risk.",
  "Split MATH 221 problem set into two blocks before Wed.",
  "You missed 1 deadline last week, keep buffer blocks on Thu."
];

const trendData = [42, 55, 47, 62, 70, 58, 75];

function App() {
  const [activeTab, setActiveTab] = useState("Dashboard");
  const [fileName, setFileName] = useState("");
  const [uploadState, setUploadState] = useState("idle");
  const [extractions, setExtractions] = useState(baseExtractions);
  const [syllabusId, setSyllabusId] = useState(null);
  const [calendar, setCalendar] = useState(null);
  const [error, setError] = useState("");
  const [tasks, setTasks] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [calendarView, setCalendarView] = useState("week");
  const [monthCursor, setMonthCursor] = useState(new Date());
  const [newTask, setNewTask] = useState({
    title: "",
    course: "",
    dueDate: "",
    estimatedMinutes: "",
    importance: ""
  });
  const [taskFormError, setTaskFormError] = useState("");
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState("sign-in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const userId = session?.user?.id || "local";

  useEffect(() => {
    if (!supabase) return;
    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session || null);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (!isMounted) return;
        setSession(newSession);
      }
    );

    return () => {
      isMounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const fetchTasks = useCallback(async () => {
    setTasksLoading(true);
    setTasksError("");
    try {
      const response = await fetch(`${API_BASE}/api/tasks`, {
        headers: {
          "X-User-Id": userId
        }
      });
      if (!response.ok) {
        throw new Error(response.statusText || "Failed to load tasks");
      }
      const data = await response.json();
      setTasks(data.tasks || []);
    } catch (err) {
      setTasksError(err?.message || "Failed to load tasks");
    } finally {
      setTasksLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const courses = useMemo(() => {
    const values = new Set(
      tasks.map((task) => task.course || "General").filter(Boolean)
    );
    return ["all", ...values];
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (courseFilter === "all") return tasks;
    return tasks.filter(
      (task) => (task.course || "General") === courseFilter
    );
  }, [courseFilter, tasks]);

  const importedEvents = calendar?.events ?? [];
  const deadlineEvents = useMemo(() => {
    const items = [];
    tasks.forEach((task) => {
      if (!task.due_date) return;
      items.push({
        id: `task-${task.id}`,
        title: task.title,
        date: task.due_date,
        type: "task"
      });
    });
    (calendar?.events || []).forEach((event) => {
      if (!event?.date) return;
      items.push({
        id: event.id || `import-${event.title}-${event.date}`,
        title: event.title,
        date: event.date,
        type: event.type || "import"
      });
    });

    const unique = new Map();
    items.forEach((item) => {
      const key = `${item.title}-${item.date}`;
      if (!unique.has(key)) {
        unique.set(key, item);
      }
    });
    return Array.from(unique.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [tasks, calendar]);

  const eventsByDate = useMemo(() => {
    const map = new Map();
    deadlineEvents.forEach((event) => {
      if (!map.has(event.date)) {
        map.set(event.date, []);
      }
      map.get(event.date).push(event);
    });
    return map;
  }, [deadlineEvents]);

  const weekDays = useMemo(() => buildWeekDays(new Date()), []);
  const monthDays = useMemo(() => buildMonthGrid(monthCursor), [monthCursor]);
  const weekLabel = weekDays[0] ? `Week of ${weekDays[0].display}` : "This week";
  const weekEventCount = useMemo(() => {
    const dateSet = new Set(weekDays.map((day) => day.iso));
    return deadlineEvents.filter((event) => dateSet.has(event.date)).length;
  }, [deadlineEvents, weekDays]);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setUploadState("uploading");
    setError("");
    setSyllabusId(null);
    setCalendar(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      setUploadState("extracting");
      const response = await fetch(`${API_BASE}/api/syllabi/upload?format=json`, {
        method: "POST",
        headers: {
          "X-User-Id": userId
        },
        body: formData
      });

      if (!response.ok) {
        let detail = "Upload failed";
        try {
          const body = await response.json();
          detail = body.detail || detail;
        } catch (err) {
          detail = response.statusText || detail;
        }
        throw new Error(detail);
      }

      const data = await response.json();
      setSyllabusId(data.syllabus_id);
      setCalendar(data.calendar);
      setExtractions(
        (data.events || []).map((event) => ({
          id: event.id,
          title: event.title,
          dueDate: event.date,
          type: event.type || "deadline",
          confidence: event.confidence ?? 0,
          status: (event.confidence ?? 0) >= 0.75 ? "accepted" : "pending"
        }))
      );
      setUploadState("review");
    } catch (err) {
      setUploadState("idle");
      setError(err?.message || "Upload failed");
    }
  };

  const handleExtractionUpdate = (id, updates) => {
    setExtractions((items) =>
      items.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const handleConfirm = async () => {
    if (!extractions.length) {
      setError("No items found. Try another PDF or add tasks manually.");
      return;
    }

    const accepted = extractions.filter((item) => item.status === "accepted");
    const candidates = accepted.length
      ? accepted
      : extractions.filter((item) => item.status !== "rejected");

    if (!candidates.length) {
      setError("Select at least one item to add.");
      return;
    }

    if (!accepted.length) {
      setExtractions((items) =>
        items.map((item) =>
          item.status !== "rejected" ? { ...item, status: "accepted" } : item
        )
      );
    }
    const courseLabel = fileName ? fileName.replace(/\\.pdf$/i, "") : null;
    setError("");
    setUploadState("confirming");

    try {
      await Promise.all(
        candidates.map(async (item) => {
          const response = await fetch(`${API_BASE}/api/tasks`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-User-Id": userId
            },
            body: JSON.stringify({
              title: item.title,
              course: item.course || courseLabel,
              due_date: item.dueDate || null,
              estimated_minutes: null,
              importance: null
            })
          });

          if (!response.ok) {
            throw new Error(response.statusText || "Failed to create tasks");
          }
          return response.json();
        })
      );
      await fetchTasks();
      setUploadState("confirmed");
      setActiveTab("Calendar");
    } catch (err) {
      setUploadState("review");
      setError(err?.message || "Failed to add tasks.");
    }
  };

  const handleTaskChange = (field, value) => {
    setNewTask((prev) => ({ ...prev, [field]: value }));
  };

  const handleTaskSubmit = async (event) => {
    event.preventDefault();
    if (!newTask.title.trim()) {
      setTaskFormError("Task title is required.");
      return;
    }

    setTaskFormError("");
    try {
      const response = await fetch(`${API_BASE}/api/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": userId
        },
        body: JSON.stringify({
          title: newTask.title.trim(),
          course: newTask.course.trim() || null,
          due_date: newTask.dueDate || null,
          estimated_minutes: newTask.estimatedMinutes
            ? Number(newTask.estimatedMinutes)
            : null,
          importance: newTask.importance ? Number(newTask.importance) : null,
          status: "pending"
        })
      });

      if (!response.ok) {
        throw new Error(response.statusText || "Failed to create task");
      }

      await fetchTasks();
      setNewTask({
        title: "",
        course: "",
        dueDate: "",
        estimatedMinutes: "",
        importance: ""
      });
    } catch (err) {
      setTaskFormError(err?.message || "Failed to create task");
    }
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    if (!supabase) return;
    setAuthLoading(true);
    setAuthError("");

    const email = authEmail.trim();
    const password = authPassword;

    try {
      const result =
        authMode === "sign-in"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });
      if (result.error) {
        throw result.error;
      }
      if (authMode === "sign-up") {
        setAuthError("Check your email to confirm your account.");
      }
    } catch (err) {
      setAuthError(err?.message || "Authentication failed.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setTasks([]);
  };

  if (!supabase) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Connect Supabase</h1>
          <p className="muted">
            Add your Supabase project URL and anon key to `frontend/.env` to enable
            login.
          </p>
          <code className="code-block">
            VITE_SUPABASE_URL=your-url{"\n"}
            VITE_SUPABASE_ANON_KEY=your-key
          </code>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>{authMode === "sign-in" ? "Welcome back" : "Create account"}</h1>
          <p className="muted">
            {authMode === "sign-in"
              ? "Sign in to keep your tasks and calendar synced."
              : "Create an account to save schedules across devices."}
          </p>
          <form className="auth-form" onSubmit={handleAuthSubmit}>
            <input
              type="email"
              placeholder="Email"
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              required
            />
            <button className="btn" type="submit" disabled={authLoading}>
              {authLoading
                ? "Loading..."
                : authMode === "sign-in"
                  ? "Sign in"
                  : "Sign up"}
            </button>
          </form>
          {authError && <p className="error">{authError}</p>}
          <button
            className="link-button"
            onClick={() =>
              setAuthMode((prev) => (prev === "sign-in" ? "sign-up" : "sign-in"))
            }
          >
            {authMode === "sign-in"
              ? "Need an account? Sign up"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">StudyFlow</span>
          <span className="brand-tag">Intelligent Study Planner</span>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-secondary">Generate plan</button>
          <button className="btn btn-secondary" onClick={handleSignOut}>
            Sign out
          </button>
          <button className="btn">Import syllabus</button>
        </div>
      </header>

      <nav className="tabs">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={`tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      <main className="content">
        {activeTab === "Dashboard" && (
          <section className="page" aria-label="Dashboard">
            <div className="hero">
              <div>
                <p className="eyebrow">This week</p>
                <h1>Your plan is 78% on track.</h1>
                <p className="muted">
                  Three deadlines in the next 5 days. Focus on CHEM 140 and
                  MATH 221.
                </p>
              </div>
              <div className="hero-card">
                <p className="muted">Next up</p>
                <h2>Quiz 3 deadline</h2>
                <p className="muted">Tue 5:30 PM</p>
                <button className="btn btn-secondary">Add buffer block</button>
              </div>
            </div>

            <div className="card-grid">
              <StatCard
                title="Upcoming deadlines"
                value="4"
                note="2 high risk"
              />
              <StatCard title="Study hours" value="12.5" note="+2.0 vs last" />
              <StatCard title="Risk score" value="0.42" note="Moderate" />
            </div>

            <div className="split-grid">
              <div className="card">
                <div className="card-head">
                  <h3>Progress trend</h3>
                  <span className="muted">last 7 days</span>
                </div>
                <div className="trend">
                  {trendData.map((value, index) => (
                    <div
                      key={value}
                      className="trend-bar"
                      style={{ height: `${value}%`, animationDelay: `${index * 60}ms` }}
                    />
                  ))}
                </div>
              </div>
              <div className="card">
                <div className="card-head">
                  <h3>Recommendations</h3>
                  <span className="muted">actionable today</span>
                </div>
                <ul className="list">
                  {recommendationList.map((item, index) => (
                    <li
                      key={item}
                      className="list-item"
                      style={{ animationDelay: `${index * 60}ms` }}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        )}

        {activeTab === "Calendar" && (
          <section className="page" aria-label="Calendar">
            <div className="page-head">
              <div>
                <h1>Calendar</h1>
                <p className="muted">
                  Your schedule is built around deadlines and availability.
                </p>
              </div>
              <div className="calendar-controls">
                <div className="pill-row">
                  <button
                    className={`pill-toggle ${calendarView === "week" ? "active" : ""}`}
                    onClick={() => setCalendarView("week")}
                  >
                    Week
                  </button>
                  <button
                    className={`pill-toggle ${calendarView === "month" ? "active" : ""}`}
                    onClick={() => setCalendarView("month")}
                  >
                    Month
                  </button>
                </div>
                {calendarView === "week" ? (
                  <div className="pill-row">
                    <span className="pill">{weekLabel}</span>
                    <span className="pill">{weekEventCount} deadlines</span>
                  </div>
                ) : (
                  <div className="pill-row">
                    <button
                      className="pill-toggle"
                      onClick={() => setMonthCursor(addMonths(monthCursor, -1))}
                    >
                      {"<"}
                    </button>
                    <span className="pill">{formatMonthYear(monthCursor)}</span>
                    <button
                      className="pill-toggle"
                      onClick={() => setMonthCursor(addMonths(monthCursor, 1))}
                    >
                      {">"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {calendarView === "week" ? (
              <div className="calendar">
                {weekDays.map((day) => {
                  const dayEvents = eventsByDate.get(day.iso) || [];
                  return (
                    <div key={day.iso} className="calendar-day">
                      <div className="calendar-head">
                        <span className="calendar-name">{day.label}</span>
                        <span className="calendar-date">{day.display}</span>
                      </div>
                      <div className="calendar-body">
                        {dayEvents.length ? (
                          dayEvents.map((event) => (
                            <div key={event.id} className="calendar-block deadline">
                              <span className="calendar-time">Due</span>
                              <span className="calendar-label">{event.title}</span>
                            </div>
                          ))
                        ) : (
                          <span className="muted">Open day</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="month-view">
                <div className="month-weekdays">
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>
                <div className="month-grid">
                  {monthDays.map((day) => {
                    const dayEvents = eventsByDate.get(day.iso) || [];
                    const preview = dayEvents.slice(0, 2);
                    return (
                      <div
                        key={day.iso}
                        className={`month-cell ${day.inMonth ? "" : "outside"}`}
                      >
                        <span className="month-date">{day.label}</span>
                        <div className="month-events">
                          {preview.map((event) => (
                            <span key={event.id} className="month-event">
                              {event.title}
                            </span>
                          ))}
                          {dayEvents.length > 2 && (
                            <span className="month-event more">
                              +{dayEvents.length - 2} more
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="card">
              <div className="card-head">
                <h3>Imported deadlines</h3>
                <span className="muted">
                  {importedEvents.length ? `${importedEvents.length} items` : "No syllabus imported"}
                </span>
              </div>
              {importedEvents.length ? (
                <div className="list">
                  {importedEvents.map((event) => (
                    <div key={event.id} className="list-item imported-item">
                      <div>
                        <p className="task-title">{event.title}</p>
                        <p className="muted">{event.type || "deadline"}</p>
                      </div>
                      <span className="pill">{event.date}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  Import a syllabus to see extracted deadlines here.
                </p>
              )}
            </div>
          </section>
        )}

        {activeTab === "Tasks" && (
          <section className="page" aria-label="Tasks">
            <div className="page-head">
              <div>
                <h1>Tasks</h1>
                <p className="muted">Review priorities and risk in one place.</p>
              </div>
              <div className="filter-row">
                <label className="select">
                  <span className="muted">Course</span>
                  <select
                    value={courseFilter}
                    onChange={(event) => setCourseFilter(event.target.value)}
                  >
                    {courses.map((course) => (
                      <option key={course} value={course}>
                        {course === "all" ? "All courses" : course}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn btn-secondary"
                  onClick={() => setActiveTab("Tasks")}
                >
                  Add task
                </button>
              </div>
            </div>

            <div className="card task-form-card">
              <div className="card-head">
                <h3>Add task</h3>
                <span className="muted">Saved in your local database</span>
              </div>
              <form className="task-form" onSubmit={handleTaskSubmit}>
                <input
                  type="text"
                  placeholder="Task title"
                  value={newTask.title}
                  onChange={(event) => handleTaskChange("title", event.target.value)}
                  required
                />
                <input
                  type="text"
                  placeholder="Course"
                  value={newTask.course}
                  onChange={(event) => handleTaskChange("course", event.target.value)}
                />
                <input
                  type="date"
                  value={newTask.dueDate}
                  onChange={(event) => handleTaskChange("dueDate", event.target.value)}
                />
                <input
                  type="number"
                  min="0"
                  placeholder="Minutes"
                  value={newTask.estimatedMinutes}
                  onChange={(event) =>
                    handleTaskChange("estimatedMinutes", event.target.value)
                  }
                />
                <input
                  type="number"
                  min="1"
                  max="5"
                  placeholder="Importance (1-5)"
                  value={newTask.importance}
                  onChange={(event) => handleTaskChange("importance", event.target.value)}
                />
                <button className="btn" type="submit">
                  Save task
                </button>
              </form>
              {taskFormError && <p className="error">{taskFormError}</p>}
            </div>

            <div className="card">
              <div className="task-header">
                <span>Task</span>
                <span>Due</span>
                <span>Estimate</span>
                <span>Risk</span>
              </div>
              {tasksLoading && <p className="muted">Loading tasks...</p>}
              {tasksError && <p className="error">Error: {tasksError}</p>}
              {!tasksLoading && !tasksError && !filteredTasks.length && (
                <p className="muted">No tasks yet. Add one above.</p>
              )}
              {!tasksLoading &&
                !tasksError &&
                filteredTasks.map((task, index) => (
                  <div
                    key={task.id}
                    className="task-row"
                    style={{ animationDelay: `${index * 60}ms` }}
                  >
                    <div>
                      <p className="task-title">{task.title}</p>
                      <p className="muted">{task.course || "General"}</p>
                    </div>
                    <span>{task.due_date || "--"}</span>
                    <span>
                      {task.estimated_minutes ? `${task.estimated_minutes} min` : "--"}
                    </span>
                    <RiskBadge level={deriveRisk(task)} />
                  </div>
                ))}
            </div>
          </section>
        )}

        {activeTab === "Import" && (
          <section className="page" aria-label="Import">
            <div className="page-head">
              <div>
                <h1>Syllabus import</h1>
                <p className="muted">
                  Upload a syllabus PDF and confirm extracted deadlines.
                </p>
              </div>
            </div>

            <div className="split-grid">
              <div className="card">
                <div className="upload">
                  <p className="eyebrow">Upload PDF</p>
                  <h2>Drop your syllabus here</h2>
                  <p className="muted">
                    We will scan for assignments, exams, and important dates.
                  </p>
                  <label className="upload-button">
                    <input type="file" accept="application/pdf" onChange={handleFileChange} />
                    Choose file
                  </label>
                  <p className="muted">{fileName || "No file selected"}</p>
                  {error && <p className="error">Error: {error}</p>}
                  <div className="steps">
                    <Step
                      label="Uploading"
                      active={uploadState === "uploading"}
                      done={uploadState !== "idle"}
                    />
                    <Step
                      label="Extracting"
                      active={uploadState === "extracting"}
                      done={
                        uploadState === "review" ||
                        uploadState === "confirming" ||
                        uploadState === "confirmed"
                      }
                    />
                    <Step
                      label="Review"
                      active={uploadState === "review" || uploadState === "confirming"}
                      done={uploadState === "confirmed"}
                    />
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h3>Extracted items</h3>
                  <span className="muted">Review before adding to calendar</span>
                </div>
                <div className="table">
                  <div className="table-row table-head">
                    <span>Title</span>
                    <span>Due</span>
                    <span>Type</span>
                    <span>Confidence</span>
                    <span>Status</span>
                  </div>
                  {extractions.length === 0 && (
                    <p className="muted">Upload a syllabus to see extracted items.</p>
                  )}
                  {extractions.map((item, index) => (
                    <div
                      key={item.id}
                      className="table-row"
                      style={{ animationDelay: `${index * 60}ms` }}
                    >
                      <input
                        value={item.title}
                        onChange={(event) =>
                          handleExtractionUpdate(item.id, { title: event.target.value })
                        }
                      />
                      <input
                        type="date"
                        value={item.dueDate}
                        onChange={(event) =>
                          handleExtractionUpdate(item.id, { dueDate: event.target.value })
                        }
                      />
                      <span className="pill small">{item.type}</span>
                      <span>{Math.round(item.confidence * 100)}%</span>
                      <div className="status">
                        <button
                          className={item.status === "accepted" ? "mini active" : "mini"}
                          onClick={() => handleExtractionUpdate(item.id, { status: "accepted" })}
                        >
                          Accept
                        </button>
                        <button
                          className={item.status === "rejected" ? "mini active" : "mini"}
                          onClick={() => handleExtractionUpdate(item.id, { status: "rejected" })}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="card-footer">
                  <button
                    className="btn btn-secondary"
                    onClick={handleConfirm}
                    disabled={uploadState === "confirming" || extractions.length === 0}
                  >
                    Confirm and add to calendar
                  </button>
                  {uploadState === "confirmed" && (
                    <span className="muted">
                      {syllabusId ? `Syllabus ${syllabusId} added and schedule updated.` : "Items added and schedule updated."}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function StatCard({ title, value, note }) {
  return (
    <div className="card stat">
      <p className="muted">{title}</p>
      <h2>{value}</h2>
      <p className="muted">{note}</p>
    </div>
  );
}

function RiskBadge({ level }) {
  const label = level === "high" ? "High" : level === "medium" ? "Medium" : "Low";
  return <span className={`badge ${level}`}>{label}</span>;
}

function Step({ label, active, done }) {
  return (
    <div className={`step ${active ? "active" : ""} ${done ? "done" : ""}`}>
      <span className="step-dot" />
      <span>{label}</span>
    </div>
  );
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMonthDay(date) {
  return `${MONTH_LABELS[date.getMonth()]} ${date.getDate()}`;
}

function formatMonthYear(date) {
  return `${MONTH_LABELS[date.getMonth()]} ${date.getFullYear()}`;
}

function getWeekStart(date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = (day + 6) % 7;
  copy.setDate(copy.getDate() - diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function buildWeekDays(date) {
  const start = getWeekStart(date);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return {
      label: DAY_LABELS[day.getDay()],
      display: formatMonthDay(day),
      iso: toISODate(day)
    };
  });
}

function buildMonthGrid(cursor) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = getWeekStart(firstOfMonth);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(gridStart);
    day.setDate(gridStart.getDate() + index);
    return {
      label: day.getDate(),
      iso: toISODate(day),
      inMonth: day.getMonth() === month
    };
  });
}

function addMonths(date, amount) {
  const copy = new Date(date);
  copy.setDate(1);
  copy.setMonth(copy.getMonth() + amount);
  return copy;
}

function deriveRisk(task) {
  const importance = Number(task.importance || 0);
  let daysToDeadline = null;
  if (task.due_date) {
    const target = new Date(`${task.due_date}T00:00:00`);
    const today = new Date();
    const diffMs = target.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0);
    daysToDeadline = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  if (daysToDeadline !== null && daysToDeadline <= 2) return "high";
  if (importance >= 4) return "high";
  if (daysToDeadline !== null && daysToDeadline <= 5) return "medium";
  if (importance >= 3) return "medium";
  return "low";
}

export default App;
