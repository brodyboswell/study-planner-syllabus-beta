from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional
from uuid import uuid4

from .db import get_connection, init_db

BASE_DIR = Path(__file__).resolve().parent.parent
STORE_DIR = BASE_DIR / "storage"


def save_record(
    filename: str,
    file_bytes: bytes,
    events: list[dict],
    calendar: dict,
    course: Optional[str] = None,
    user_id: Optional[str] = None
) -> dict:
    init_db()
    owner_id = user_id or "local"
    syllabus_id = f"syl_{uuid4().hex[:12]}"
    file_path = STORE_DIR / f"{syllabus_id}.pdf"
    file_path.write_bytes(file_bytes)

    created_at = datetime.utcnow().isoformat()
    with get_connection() as connection:
        connection.execute(
            "INSERT INTO syllabi (id, user_id, file_name, course, created_at) VALUES (?, ?, ?, ?, ?)",
            (syllabus_id, owner_id, filename, course, created_at)
        )
        for event in events:
            connection.execute(
                """
                INSERT INTO syllabus_events (
                    syllabus_id,
                    event_uid,
                    title,
                    event_date,
                    event_type,
                    confidence,
                    source_page,
                    source_line
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    syllabus_id,
                    event.get("id"),
                    event.get("title"),
                    event.get("date"),
                    event.get("type"),
                    event.get("confidence"),
                    event.get("source_page"),
                    event.get("source_line")
                )
            )

    return {
        "id": syllabus_id,
        "user_id": owner_id,
        "file_name": filename,
        "course": course,
        "created_at": created_at,
        "events": events,
        "calendar": calendar
    }


def get_record(syllabus_id: str, user_id: Optional[str] = None) -> Optional[dict]:
    init_db()
    owner_id = user_id or "local"
    with get_connection() as connection:
        syllabus = connection.execute(
            "SELECT * FROM syllabi WHERE id = ? AND user_id = ?",
            (syllabus_id, owner_id)
        ).fetchone()
        if not syllabus:
            return None

        event_rows = connection.execute(
            "SELECT * FROM syllabus_events WHERE syllabus_id = ? ORDER BY event_date",
            (syllabus_id,)
        ).fetchall()

    events = [
        {
            "id": row["event_uid"] or f"evt_{row['id']}",
            "title": row["title"],
            "date": row["event_date"],
            "type": row["event_type"],
            "confidence": row["confidence"],
            "source_page": row["source_page"],
            "source_line": row["source_line"]
        }
        for row in event_rows
    ]

    return {
        "id": syllabus["id"],
        "user_id": syllabus["user_id"],
        "file_name": syllabus["file_name"],
        "course": syllabus["course"],
        "created_at": syllabus["created_at"],
        "events": events
    }


def list_tasks(user_id: Optional[str] = None) -> list[dict]:
    init_db()
    owner_id = user_id or "local"
    with get_connection() as connection:
        rows = connection.execute(
            "SELECT * FROM tasks WHERE user_id = ? ORDER BY due_date",
            (owner_id,)
        ).fetchall()
    return [dict(row) for row in rows]


def get_task(task_id: int, user_id: Optional[str] = None) -> Optional[dict]:
    init_db()
    owner_id = user_id or "local"
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
            (task_id, owner_id)
        ).fetchone()
    return dict(row) if row else None


def create_task(data: dict, user_id: Optional[str] = None) -> dict:
    init_db()
    owner_id = user_id or "local"
    created_at = datetime.utcnow().isoformat()
    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO tasks (
                user_id,
                title,
                course,
                description,
                task_type,
                due_date,
                estimated_minutes,
                importance,
                status,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                owner_id,
                data.get("title"),
                data.get("course"),
                data.get("description"),
                data.get("task_type"),
                data.get("due_date"),
                data.get("estimated_minutes"),
                data.get("importance"),
                data.get("status", "pending"),
                created_at
            )
        )
        task_id = cursor.lastrowid

    task = get_task(task_id, owner_id)
    return task or {
        "id": task_id,
        "user_id": owner_id,
        "title": data.get("title"),
        "course": data.get("course"),
        "description": data.get("description"),
        "task_type": data.get("task_type"),
        "due_date": data.get("due_date"),
        "estimated_minutes": data.get("estimated_minutes"),
        "importance": data.get("importance"),
        "status": data.get("status", "pending"),
        "created_at": created_at
    }


def update_task(task_id: int, updates: dict, user_id: Optional[str] = None) -> Optional[dict]:
    init_db()
    owner_id = user_id or "local"
    allowed_fields = {
        "title",
        "course",
        "description",
        "task_type",
        "due_date",
        "estimated_minutes",
        "importance",
        "status"
    }
    set_items = [(key, value) for key, value in updates.items() if key in allowed_fields]
    if not set_items:
        return get_task(task_id, owner_id)

    set_clause = ", ".join([f"{key} = ?" for key, _ in set_items])
    values = [value for _, value in set_items]
    values.append(task_id)
    values.append(owner_id)

    with get_connection() as connection:
        connection.execute(
            f"UPDATE tasks SET {set_clause} WHERE id = ? AND user_id = ?",
            values
        )

    return get_task(task_id, owner_id)


def delete_task(task_id: int, user_id: Optional[str] = None) -> bool:
    init_db()
    owner_id = user_id or "local"
    with get_connection() as connection:
        cursor = connection.execute(
            "DELETE FROM tasks WHERE id = ? AND user_id = ?",
            (task_id, owner_id)
        )
    return cursor.rowcount > 0
