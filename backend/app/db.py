from __future__ import annotations

import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
STORE_DIR = BASE_DIR / "storage"
DB_PATH = STORE_DIR / "app.db"


def get_connection() -> sqlite3.Connection:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    STORE_DIR.mkdir(parents=True, exist_ok=True)
    with get_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                title TEXT NOT NULL,
                course TEXT,
                description TEXT,
                task_type TEXT,
                due_date TEXT,
                estimated_minutes INTEGER,
                importance INTEGER,
                status TEXT DEFAULT 'pending',
                created_at TEXT
            );

            CREATE TABLE IF NOT EXISTS syllabi (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                file_name TEXT NOT NULL,
                course TEXT,
                created_at TEXT
            );

            CREATE TABLE IF NOT EXISTS syllabus_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                syllabus_id TEXT NOT NULL,
                event_uid TEXT NOT NULL,
                title TEXT NOT NULL,
                event_date TEXT NOT NULL,
                event_type TEXT,
                confidence REAL,
                source_page INTEGER,
                source_line TEXT,
                FOREIGN KEY (syllabus_id) REFERENCES syllabi(id)
            );

            CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
            CREATE INDEX IF NOT EXISTS idx_syllabus_events_syllabus ON syllabus_events(syllabus_id);
            """
        )

        _ensure_column(connection, "tasks", "user_id", "TEXT")
        _ensure_column(connection, "tasks", "description", "TEXT")
        _ensure_column(connection, "tasks", "task_type", "TEXT")
        _ensure_column(connection, "syllabi", "user_id", "TEXT")

        connection.execute("UPDATE tasks SET user_id = 'local' WHERE user_id IS NULL")
        connection.execute("UPDATE syllabi SET user_id = 'local' WHERE user_id IS NULL")

        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_tasks_user_due_date ON tasks(user_id, due_date)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_syllabi_user ON syllabi(user_id)"
        )


def _ensure_column(connection: sqlite3.Connection, table: str, column: str, column_type: str) -> None:
    existing = connection.execute(f"PRAGMA table_info({table})").fetchall()
    if any(row["name"] == column for row in existing):
        return
    connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")
