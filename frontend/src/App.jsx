import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient.js";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const tabs = ["Dashboard", "Calendar", "Tasks", "Import"];

const baseExtractions = [];

const TASK_TYPES = [
  { value: "assignment", label: "Assignment" },
  { value: "essay", label: "Essay" },
  { value: "discussion", label: "Discussion" },
  { value: "project", label: "Project" },
  { value: "exam", label: "Exam" },
  { value: "lecture", label: "Lecture" }
];

const TASK_TYPE_WEIGHTS = {
  assignment: 1,
  essay: 2,
  discussion: 1,
  project: 3,
  exam: 3,
  lecture: 1
};

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
    description: "",
    taskType: "",
    dueDate: "",
    estimatedMinutes: "",
    importance: ""
  });
  const [taskFormError, setTaskFormError] = useState("");
  const [activeTask, setActiveTask] = useState(null);
  const [taskEdit, setTaskEdit] = useState(null);
  const [taskSaving, setTaskSaving] = useState(false);
  const [taskEditError, setTaskEditError] = useState("");
  const [session, setSession] = useState(null);
  const [authMode, setAuthMode] = useState("sign-in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const userId = session?.user?.id;
  const userEmail = session?.user?.email || "";
  const userName = session?.user?.user_metadata?.full_name || "";
  const userLabel = userName || userEmail || "your account";

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
    if (!userId) {
      setTasks([]);
      setTasksLoading(false);
      setTasksError("");
      return;
    }
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

  useEffect(() => {
    setCalendar(null);
    setExtractions(baseExtractions);
    setSyllabusId(null);
    setUploadState("idle");
    setFileName("");
    setError("");
    setActiveTask(null);
    setTaskEdit(null);
    setTaskEditError("");
    setTaskSaving(false);
  }, [userId]);

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
  const extractionSummary = useMemo(() => {
    return extractions.reduce(
      (summary, item) => {
        const status = item.status || "pending";
        if (status === "accepted") summary.accepted += 1;
        else if (status === "rejected") summary.rejected += 1;
        else summary.pending += 1;
        return summary;
      },
      { accepted: 0, pending: 0, rejected: 0 }
    );
  }, [extractions]);
  const activeTasks = useMemo(
    () => tasks.filter((task) => task.status !== "done"),
    [tasks]
  );
  const tasksWithDueDates = useMemo(() => {
    return tasks
      .map((task) => {
        const dueDate = parseISODate(task.due_date);
        if (!dueDate) return null;
        return {
          ...task,
          dueDate,
          daysUntil: daysUntilDate(dueDate)
        };
      })
      .filter(Boolean);
  }, [tasks]);
  const activeTasksWithDueDates = useMemo(
    () => tasksWithDueDates.filter((task) => task.status !== "done"),
    [tasksWithDueDates]
  );
  const upcomingTasks = useMemo(() => {
    return activeTasksWithDueDates
      .filter((task) => task.daysUntil !== null && task.daysUntil >= 0)
      .sort((a, b) => a.dueDate - b.dueDate);
  }, [activeTasksWithDueDates]);
  const upcomingAssignments = useMemo(
    () => upcomingTasks.slice(0, 8),
    [upcomingTasks]
  );
  const overdueTasks = useMemo(() => {
    return activeTasksWithDueDates
      .filter((task) => task.daysUntil !== null && task.daysUntil < 0)
      .sort((a, b) => a.dueDate - b.dueDate);
  }, [activeTasksWithDueDates]);
  const nextTask = upcomingTasks[0] || overdueTasks[0] || null;
  const tasksDueSoonCount = useMemo(() => {
    return activeTasksWithDueDates.filter(
      (task) => task.daysUntil !== null && task.daysUntil >= 0 && task.daysUntil <= 5
    ).length;
  }, [activeTasksWithDueDates]);
  const focusCourses = useMemo(() => {
    const focusTasks = activeTasksWithDueDates.filter(
      (task) => task.daysUntil !== null && task.daysUntil >= 0 && task.daysUntil <= 14
    );
    return getTopCourses(focusTasks, 2);
  }, [activeTasksWithDueDates]);
  const focusText =
    focusCourses.length === 0
      ? ""
      : focusCourses.length === 1
        ? `Focus on ${focusCourses[0]}.`
        : `Focus on ${focusCourses[0]} and ${focusCourses[1]}.`;
  const heroSummary = useMemo(() => {
    if (!tasks.length) {
      return "Add tasks to see upcoming deadlines and recommendations.";
    }
    if (!tasksWithDueDates.length) {
      return "Add due dates to keep your upcoming deadlines accurate.";
    }
    if (!tasksDueSoonCount) {
      return "No deadlines in the next 5 days. You're in good shape.";
    }
    return `${tasksDueSoonCount} deadlines in the next 5 days.${focusText ? ` ${focusText}` : ""}`;
  }, [focusText, tasks.length, tasksDueSoonCount, tasksWithDueDates.length]);
  const weekDateSet = useMemo(
    () => new Set(weekDays.map((day) => day.iso)),
    [weekDays]
  );
  const tasksDueThisWeek = useMemo(() => {
    return tasksWithDueDates.filter((task) =>
      weekDateSet.has(toISODate(task.dueDate))
    );
  }, [tasksWithDueDates, weekDateSet]);
  const completedThisWeek = useMemo(
    () => tasksDueThisWeek.filter((task) => task.status === "done").length,
    [tasksDueThisWeek]
  );
  const completedTasks = useMemo(
    () => tasks.filter((task) => task.status === "done").length,
    [tasks]
  );
  const progressPercent = useMemo(() => {
    if (tasksDueThisWeek.length) {
      return Math.round((completedThisWeek / tasksDueThisWeek.length) * 100);
    }
    if (tasks.length) {
      return Math.round((completedTasks / tasks.length) * 100);
    }
    return null;
  }, [completedThisWeek, completedTasks, tasks.length, tasksDueThisWeek.length]);
  const riskCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    activeTasks.forEach((task) => {
      const level = deriveRisk(task);
      counts[level] += 1;
    });
    return counts;
  }, [activeTasks]);
  const riskScore = useMemo(() => {
    const total = activeTasks.length;
    if (!total) return null;
    const score =
      (riskCounts.high * 1 + riskCounts.medium * 0.6 + riskCounts.low * 0.2) /
      total;
    return Number(score.toFixed(2));
  }, [activeTasks.length, riskCounts]);
  const riskLabel =
    riskScore === null
      ? "No data"
      : riskScore >= 0.6
        ? "High"
        : riskScore >= 0.35
          ? "Moderate"
          : "Low";
  const upcomingWeekCount = useMemo(() => {
    return activeTasksWithDueDates.filter(
      (task) => task.daysUntil !== null && task.daysUntil >= 0 && task.daysUntil <= 7
    ).length;
  }, [activeTasksWithDueDates]);
  const upcomingNote = useMemo(() => {
    if (!upcomingWeekCount) {
      if (!tasks.length) return "No tasks yet";
      if (!tasksWithDueDates.length) return "Add due dates to track deadlines";
      return "No upcoming deadlines";
    }
    return `${riskCounts.high} high risk`;
  }, [riskCounts.high, tasks.length, tasksWithDueDates.length, upcomingWeekCount]);
  const estimatedMinutesThisWeek = useMemo(() => {
    return activeTasksWithDueDates
      .filter((task) => task.daysUntil !== null && task.daysUntil >= 0 && task.daysUntil <= 7)
      .reduce((total, task) => total + (task.estimated_minutes || 0), 0);
  }, [activeTasksWithDueDates]);
  const estimatedTasksCount = useMemo(() => {
    return activeTasksWithDueDates.filter(
      (task) =>
        task.daysUntil !== null &&
        task.daysUntil >= 0 &&
        task.daysUntil <= 7 &&
        task.estimated_minutes
    ).length;
  }, [activeTasksWithDueDates]);
  const studyHours = estimatedMinutesThisWeek / 60;
  const studyHoursLabel = studyHours ? studyHours.toFixed(1) : "0.0";
  const weekDeadlineCounts = useMemo(() => {
    const indexMap = new Map(weekDays.map((day, index) => [day.iso, index]));
    const counts = weekDays.map(() => 0);
    tasksWithDueDates.forEach((task) => {
      const index = indexMap.get(task.due_date);
      if (index !== undefined) {
        counts[index] += 1;
      }
    });
    return counts;
  }, [tasksWithDueDates, weekDays]);
  const weekDeadlineTotal = useMemo(
    () => weekDeadlineCounts.reduce((total, value) => total + value, 0),
    [weekDeadlineCounts]
  );
  const weekTrendMax = Math.max(1, ...weekDeadlineCounts);
  const recommendations = useMemo(() => {
    const items = [];
    const highRiskTasks = activeTasksWithDueDates
      .filter((task) => deriveRisk(task) === "high")
      .sort((a, b) => a.dueDate - b.dueDate);
    if (highRiskTasks.length) {
      const task = highRiskTasks[0];
      const course = task.course || "General";
      items.push(
        `Prioritize ${task.title} for ${course} by ${formatMonthDay(task.dueDate)}.`
      );
    }
    const longTasks = activeTasksWithDueDates
      .filter((task) => (task.estimated_minutes || 0) >= 120)
      .sort((a, b) => a.dueDate - b.dueDate);
    if (longTasks.length && items.length < 3) {
      const task = longTasks[0];
      items.push(`Split ${task.title} into smaller blocks before ${formatMonthDay(task.dueDate)}.`);
    }
    const soonTasks = upcomingTasks.filter(
      (task) => task.daysUntil !== null && task.daysUntil >= 0 && task.daysUntil <= 2
    );
    if (soonTasks.length && items.length < 3) {
      const task = soonTasks[0];
      items.push(`Schedule time for ${task.title} due ${formatMonthDay(task.dueDate)}.`);
    }
    const noDateTasks = activeTasks.filter((task) => !task.due_date);
    if (noDateTasks.length && items.length < 3) {
      items.push(`Add a due date for ${noDateTasks[0].title} to keep the plan accurate.`);
    }
    if (!items.length) {
      return ["Add tasks to receive recommendations tailored to your week."];
    }
    return items.slice(0, 3);
  }, [activeTasks, activeTasksWithDueDates, upcomingTasks]);

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!userId) {
      setError("Sign in to upload a syllabus.");
      setUploadState("idle");
      return;
    }
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
      const extractedEvents = data.events || [];
      setExtractions(
        extractedEvents.map((event) => ({
          id: event.id,
          title: event.title,
          dueDate: event.date,
          type: event.type || "deadline",
          taskType: mapEventTypeToTaskType(event.type),
          confidence: event.confidence ?? 0,
          status: (event.confidence ?? 0) >= 0.75 ? "accepted" : "pending"
        }))
      );
      if (!extractedEvents.length) {
        setError("No dated items were detected. Try another PDF or add tasks manually.");
      }
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
    if (!userId) {
      setError("Sign in to add tasks from a syllabus.");
      return;
    }
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

    const invalidTitles = candidates.filter((item) => !item.title?.trim());
    if (invalidTitles.length) {
      setError("Each extracted item needs a title before confirming.");
      return;
    }

    if (!accepted.length) {
      setExtractions((items) =>
        items.map((item) =>
          item.status !== "rejected" ? { ...item, status: "accepted" } : item
        )
      );
    }
    const courseLabel =
      extractCourseFromFilename(fileName) ||
      (fileName ? fileName.replace(/\\.pdf$/i, "") : null);
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
              title: item.title.trim(),
              course: item.course || courseLabel,
              task_type: item.taskType || mapEventTypeToTaskType(item.type),
              due_date: item.dueDate || null,
              estimated_minutes: null,
              importance: null
            })
          });

          if (!response.ok) {
            let detail = response.statusText || "Failed to create tasks";
            try {
              const body = await response.json();
              if (body?.detail) {
                if (Array.isArray(body.detail)) {
                  detail = body.detail.map((entry) => entry.msg).join(", ");
                } else {
                  detail = body.detail;
                }
              }
            } catch (err) {
              detail = response.statusText || detail;
            }
            throw new Error(detail);
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
    if (!userId) {
      setTaskFormError("Sign in to save tasks.");
      return;
    }
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
          description: newTask.description.trim() || null,
          task_type: newTask.taskType || null,
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
        description: "",
        taskType: "",
        dueDate: "",
        estimatedMinutes: "",
        importance: ""
      });
    } catch (err) {
      setTaskFormError(err?.message || "Failed to create task");
    }
  };

  const openTaskEditor = useCallback((task) => {
    setActiveTask(task);
    setTaskEdit({
      title: task.title || "",
      course: task.course || "",
      description: task.description || "",
      taskType: task.task_type || "",
      dueDate: task.due_date || "",
      estimatedMinutes:
        task.estimated_minutes !== null && task.estimated_minutes !== undefined
          ? String(task.estimated_minutes)
          : "",
      importance:
        task.importance !== null && task.importance !== undefined
          ? String(task.importance)
          : "",
      status: task.status || "pending"
    });
    setTaskEditError("");
  }, []);

  const closeTaskEditor = useCallback(() => {
    setActiveTask(null);
    setTaskEdit(null);
    setTaskEditError("");
    setTaskSaving(false);
  }, []);

  const handleTaskEditChange = (field, value) => {
    setTaskEdit((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const saveTaskUpdates = useCallback(
    async (updates = {}) => {
      if (!userId || !activeTask || !taskEdit) return;
      const merged = { ...taskEdit, ...updates };
      const estimatedMinutes =
        merged.estimatedMinutes === "" ? null : Number(merged.estimatedMinutes);
      const importance = merged.importance === "" ? null : Number(merged.importance);
      const description = (merged.description || "").trim();
      const payload = {
        title: (merged.title || "").trim(),
        course: (merged.course || "").trim() || null,
        description: description || null,
        task_type: merged.taskType || null,
        due_date: merged.dueDate || null,
        estimated_minutes: Number.isNaN(estimatedMinutes) ? null : estimatedMinutes,
        importance: Number.isNaN(importance) ? null : importance,
        status: merged.status || "pending"
      };

      if (!payload.title) {
        setTaskEditError("Task title is required.");
        return;
      }

      setTaskSaving(true);
      setTaskEditError("");
      try {
        const response = await fetch(`${API_BASE}/api/tasks/${activeTask.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-User-Id": userId
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(response.statusText || "Failed to update task");
        }

        await fetchTasks();
        closeTaskEditor();
      } catch (err) {
        setTaskEditError(err?.message || "Failed to update task.");
      } finally {
        setTaskSaving(false);
      }
    },
    [activeTask, closeTaskEditor, fetchTasks, taskEdit, userId]
  );

  const handleTaskEditSubmit = (event) => {
    event.preventDefault();
    saveTaskUpdates();
  };

  const markTaskComplete = () => {
    saveTaskUpdates({ status: "done" });
  };

  const deleteTask = async () => {
    if (!userId || !activeTask) return;
    const confirmMessage = `Delete "${activeTask.title}"? This cannot be undone.`;
    if (!window.confirm(confirmMessage)) return;
    setTaskSaving(true);
    setTaskEditError("");
    try {
      const response = await fetch(`${API_BASE}/api/tasks/${activeTask.id}`, {
        method: "DELETE",
        headers: {
          "X-User-Id": userId
        }
      });
      if (!response.ok) {
        throw new Error(response.statusText || "Failed to delete task");
      }
      await fetchTasks();
      closeTaskEditor();
    } catch (err) {
      setTaskEditError(err?.message || "Failed to delete task.");
      setTaskSaving(false);
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
    setCalendar(null);
    setExtractions(baseExtractions);
    setSyllabusId(null);
    setUploadState("idle");
    setFileName("");
    setError("");
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
          <span className="brand-tag">Signed in as {userLabel}</span>
        </div>
        <div className="topbar-actions">
          <button className="btn btn-secondary" onClick={handleSignOut}>
            Sign out
          </button>
          <button className="btn" onClick={() => setActiveTab("Import")}>
            Import syllabus
          </button>
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
                <p className="eyebrow">{weekLabel}</p>
                <h1>
                  {progressPercent === null
                    ? "Build your plan for the week."
                    : `Your plan is ${progressPercent}% on track.`}
                </h1>
                <p className="muted">{heroSummary}</p>
              </div>
              <div className="hero-card">
                <p className="muted">Next up</p>
                <h2>{nextTask ? nextTask.title : "No upcoming deadlines"}</h2>
                <p className="muted">
                  {nextTask
                    ? `${nextTask.course ? `${nextTask.course} · ` : ""}${
                        nextTask.daysUntil < 0
                          ? `Overdue ${formatShortDate(nextTask.dueDate)}`
                          : `Due ${formatShortDate(nextTask.dueDate)}`
                      }`
                    : "You're all caught up."}
                </p>
                <button className="btn btn-secondary" onClick={() => setActiveTab("Tasks")}>
                  {nextTask ? "Add task" : "Add your first task"}
                </button>
              </div>
            </div>

            <div className="card-grid">
              <StatCard
                title="Upcoming deadlines"
                value={String(upcomingWeekCount)}
                note={upcomingNote}
              />
              <StatCard
                title="Study hours"
                value={studyHoursLabel}
                note={
                  estimatedTasksCount
                    ? `${estimatedTasksCount} tasks estimated`
                    : "No estimates yet"
                }
              />
              <StatCard
                title="Risk score"
                value={riskScore === null ? "--" : riskScore.toFixed(2)}
                note={riskLabel}
              />
            </div>

            <div className="split-grid">
              <div className="card">
                <div className="card-head">
                  <h3>Deadline trend</h3>
                  <span className="muted">{weekLabel}</span>
                </div>
                <div className="trend">
                  {weekDeadlineTotal ? (
                    weekDeadlineCounts.map((value, index) => (
                      <div
                        key={weekDays[index].iso}
                        className="trend-bar"
                        style={{
                          height: `${Math.round((value / weekTrendMax) * 100)}%`,
                          animationDelay: `${index * 60}ms`
                        }}
                      />
                    ))
                  ) : (
                    <p className="muted">No deadlines scheduled this week.</p>
                  )}
                </div>
              </div>
              <div className="card">
                <div className="card-head">
                  <h3>Recommendations</h3>
                  <span className="muted">actionable today</span>
                </div>
                <ul className="list">
                  {recommendations.map((item, index) => (
                    <li
                      key={`${index}-${item}`}
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
                <h3>Upcoming assignments</h3>
                <span className="muted">
                  {upcomingAssignments.length
                    ? `${upcomingAssignments.length} items`
                    : "No upcoming assignments"}
                </span>
              </div>
              {upcomingAssignments.length ? (
                <div className="list">
                  {upcomingAssignments.map((task) => {
                    const dueDate = task.due_date
                      ? parseISODate(task.due_date)
                      : null;
                    const dueLabel = dueDate ? formatShortDate(dueDate) : "--";
                    return (
                      <div key={task.id} className="list-item imported-item">
                        <div>
                          <p className="task-title">{task.title}</p>
                          <div className="task-meta">
                            <span className="muted">{task.course || "General"}</span>
                            {task.task_type && <TaskTypeBadge value={task.task_type} />}
                          </div>
                        </div>
                        <span className="pill">{dueLabel}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="muted">No upcoming assignments. Add tasks to get started.</p>
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
                <span className="muted">Saved to {userLabel}'s calendar</span>
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
                <div className="task-type-field">
                  <span className="muted">Type</span>
                  <TaskTypePicker
                    value={newTask.taskType}
                    onChange={(value) => handleTaskChange("taskType", value)}
                  />
                </div>
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
                <textarea
                  placeholder="Description (optional)"
                  value={newTask.description}
                  onChange={(event) => handleTaskChange("description", event.target.value)}
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
                      <button
                        className="task-title task-title-button"
                        type="button"
                        onClick={() => openTaskEditor(task)}
                        aria-haspopup="dialog"
                      >
                        {task.title}
                      </button>
                      <div className="task-meta">
                        <span className="muted">{task.course || "General"}</span>
                        {task.task_type && <TaskTypeBadge value={task.task_type} />}
                      </div>
                      {task.description && (
                        <p className="task-description">{task.description}</p>
                      )}
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
                <div className="card-head review-head">
                  <div>
                    <h3>Review extracted items</h3>
                    <p className="muted">
                      Update titles, pick a type, and confirm what should be added.
                    </p>
                  </div>
                  <div className="review-summary">
                    <span className="pill">Total {extractions.length}</span>
                    <span className="pill">Accepted {extractionSummary.accepted}</span>
                    <span className="pill">Pending {extractionSummary.pending}</span>
                    <span className="pill">Rejected {extractionSummary.rejected}</span>
                  </div>
                </div>
                {extractions.length === 0 ? (
                  <p className="muted">Upload a syllabus to see extracted items.</p>
                ) : (
                  <div className="extracted-list">
                    {extractions.map((item, index) => {
                      const confidenceValue = item.confidence ?? 0;
                      const confidencePercent = Math.round(confidenceValue * 100);
                      const confidenceLevel = getConfidenceLevel(confidenceValue);
                      return (
                        <div
                          key={item.id}
                          className={`extracted-card ${item.status || "pending"}`}
                          style={{ animationDelay: `${index * 60}ms` }}
                        >
                          <div className="extracted-main">
                            <label className="field">
                              <span className="muted">Title</span>
                              <input
                                value={item.title}
                                onChange={(event) =>
                                  handleExtractionUpdate(item.id, {
                                    title: event.target.value
                                  })
                                }
                              />
                            </label>
                            <div className="extracted-row">
                              <label className="field">
                                <span className="muted">Due date</span>
                                <input
                                  type="date"
                                  value={item.dueDate}
                                  onChange={(event) =>
                                    handleExtractionUpdate(item.id, {
                                      dueDate: event.target.value
                                    })
                                  }
                                />
                              </label>
                              <label className="field">
                                <span className="muted">Type</span>
                                <select
                                  value={item.taskType || ""}
                                  onChange={(event) =>
                                    handleExtractionUpdate(item.id, {
                                      taskType: event.target.value
                                    })
                                  }
                                >
                                  <option value="">Choose type</option>
                                  {TASK_TYPES.map((type) => (
                                    <option key={type.value} value={type.value}>
                                      {type.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <div className="extracted-meta">
                              <span className={`confidence-pill ${confidenceLevel}`}>
                                {confidencePercent}% confidence
                              </span>
                              <span className="pill small">
                                Detected {formatEventType(item.type)}
                              </span>
                            </div>
                          </div>
                          <div className="extracted-actions">
                            <button
                              className={item.status === "accepted" ? "mini active" : "mini"}
                              onClick={() =>
                                handleExtractionUpdate(item.id, { status: "accepted" })
                              }
                            >
                              Accept
                            </button>
                            <button
                              className={item.status === "rejected" ? "mini active" : "mini"}
                              onClick={() =>
                                handleExtractionUpdate(item.id, { status: "rejected" })
                              }
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
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
      {activeTask && taskEdit && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-editor-title"
          onClick={closeTaskEditor}
        >
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <p className="eyebrow">Task details</p>
                <h2 id="task-editor-title">{taskEdit.title || "Untitled task"}</h2>
              </div>
              <button className="modal-close" type="button" onClick={closeTaskEditor}>
                Close
              </button>
            </div>
            <form className="modal-form" onSubmit={handleTaskEditSubmit}>
              <div className="modal-body">
                <label className="field">
                  <span className="muted">Title</span>
                  <input
                    type="text"
                    value={taskEdit.title}
                    onChange={(event) => handleTaskEditChange("title", event.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span className="muted">Course</span>
                  <input
                    type="text"
                    value={taskEdit.course}
                    onChange={(event) => handleTaskEditChange("course", event.target.value)}
                  />
                </label>
                <label className="field field-span">
                  <span className="muted">Description</span>
                  <textarea
                    rows="3"
                    value={taskEdit.description}
                    onChange={(event) => handleTaskEditChange("description", event.target.value)}
                    placeholder="Add details to keep the plan accurate."
                  />
                </label>
                <div className="field field-span">
                  <span className="muted">Type</span>
                  <TaskTypePicker
                    value={taskEdit.taskType}
                    onChange={(value) => handleTaskEditChange("taskType", value)}
                  />
                </div>
                <label className="field">
                  <span className="muted">Due date</span>
                  <input
                    type="date"
                    value={taskEdit.dueDate}
                    onChange={(event) => handleTaskEditChange("dueDate", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="muted">Estimated minutes</span>
                  <input
                    type="number"
                    min="0"
                    value={taskEdit.estimatedMinutes}
                    onChange={(event) =>
                      handleTaskEditChange("estimatedMinutes", event.target.value)
                    }
                  />
                </label>
                <label className="field">
                  <span className="muted">Importance (1-5)</span>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={taskEdit.importance}
                    onChange={(event) => handleTaskEditChange("importance", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="muted">Status</span>
                  <select
                    value={taskEdit.status}
                    onChange={(event) => handleTaskEditChange("status", event.target.value)}
                  >
                    <option value="pending">Pending</option>
                    <option value="in_progress">In progress</option>
                    <option value="done">Completed</option>
                  </select>
                </label>
              </div>
              {taskEditError && <p className="error">{taskEditError}</p>}
              <div className="modal-footer">
                <div className="modal-actions">
                  <button
                    className="btn btn-danger"
                    type="button"
                    onClick={deleteTask}
                    disabled={taskSaving}
                  >
                    Delete
                  </button>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={closeTaskEditor}
                    disabled={taskSaving}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={markTaskComplete}
                    disabled={taskSaving || taskEdit.status === "done"}
                  >
                    {taskEdit.status === "done" ? "Completed" : "Mark complete"}
                  </button>
                </div>
                <button className="btn" type="submit" disabled={taskSaving}>
                  {taskSaving ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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

function TaskTypeBadge({ value }) {
  if (!value) return null;
  const label = getTaskTypeLabel(value);
  const isKnown = TASK_TYPES.some((type) => type.value === value);
  return (
    <span className={`type-pill small ${isKnown ? value : "neutral"}`}>
      {label}
    </span>
  );
}

function TaskTypePicker({ value, onChange }) {
  return (
    <div className="type-picker">
      {TASK_TYPES.map((type) => {
        const selected = value === type.value;
        return (
          <button
            key={type.value}
            type="button"
            className={`type-pill ${type.value} ${selected ? "active" : ""}`}
            onClick={() => onChange(selected ? "" : type.value)}
          >
            {type.label}
          </button>
        );
      })}
    </div>
  );
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

function parseISODate(dateString) {
  if (!dateString) return null;
  const parsed = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function daysUntilDate(targetDate, referenceDate = new Date()) {
  const target = new Date(targetDate);
  const reference = new Date(referenceDate);
  target.setHours(0, 0, 0, 0);
  reference.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - reference.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function formatShortDate(date) {
  const label = DAY_LABELS[date.getDay()];
  return `${label} ${formatMonthDay(date)}`;
}

function getTopCourses(tasks, limit) {
  const counts = new Map();
  tasks.forEach((task) => {
    const course = task.course?.trim() || "General";
    counts.set(course, (counts.get(course) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([course]) => course);
}

function getTaskTypeLabel(value) {
  return TASK_TYPES.find((type) => type.value === value)?.label || "Unspecified";
}

function getTaskTypeWeight(value) {
  return TASK_TYPE_WEIGHTS[value] ?? 1;
}

function extractCourseFromFilename(filename) {
  if (!filename) return null;
  const cleaned = filename.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");
  const match = cleaned.match(/([A-Za-z]{2,})\s*(\d{2,4})/);
  if (!match) return null;
  const [, prefix, number] = match;
  return `${prefix.toUpperCase()} ${number}`;
}

function mapEventTypeToTaskType(eventType) {
  if (!eventType) return null;
  const normalized = eventType.toLowerCase();
  if (normalized === "exam" || normalized === "quiz") return "exam";
  if (normalized === "project") return "project";
  if (normalized === "assignment" || normalized === "lab") return "assignment";
  if (normalized === "reading") return "discussion";
  if (normalized === "lecture") return "lecture";
  if (normalized === "essay") return "essay";
  return null;
}

function formatEventType(eventType) {
  if (!eventType) return "Unspecified";
  return eventType
    .split(/[\s_-]+/)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function getConfidenceLevel(value) {
  if (value >= 0.75) return "high";
  if (value >= 0.5) return "medium";
  return "low";
}

function deriveRisk(task) {
  const importance = Number(task.importance || 0);
  const typeWeight = getTaskTypeWeight(task.task_type);
  let daysToDeadline = null;
  if (task.due_date) {
    const target = parseISODate(task.due_date);
    if (target) {
      daysToDeadline = daysUntilDate(target);
    }
  }

  let score = typeWeight;
  if (importance >= 4) score += 2;
  else if (importance >= 3) score += 1;

  if (daysToDeadline !== null) {
    if (daysToDeadline <= 2) score += 3;
    else if (daysToDeadline <= 5) score += 2;
    else if (daysToDeadline <= 10) score += 1;
  }

  if (score >= 6) return "high";
  if (score >= 3) return "medium";
  return "low";
}

export default App;
