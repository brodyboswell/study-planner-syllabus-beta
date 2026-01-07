from __future__ import annotations

from typing import Optional

import os

from fastapi import FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel

from .db import init_db
from .extract import build_calendar, calendar_to_ics, extract_events_from_pdf_bytes
from .store import (
    create_task,
    delete_task,
    get_record,
    get_task,
    list_tasks,
    save_record,
    update_task
)

app = FastAPI(title="StudyFlow Backend")

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"]
)


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}


def _require_user_id(x_user_id: Optional[str]) -> str:
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Sign in required.")
    return x_user_id


class TaskIn(BaseModel):
    title: str
    course: Optional[str] = None
    description: Optional[str] = None
    task_type: Optional[str] = None
    due_date: Optional[str] = None
    estimated_minutes: Optional[int] = None
    importance: Optional[int] = None
    status: Optional[str] = "pending"


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    course: Optional[str] = None
    description: Optional[str] = None
    task_type: Optional[str] = None
    due_date: Optional[str] = None
    estimated_minutes: Optional[int] = None
    importance: Optional[int] = None
    status: Optional[str] = None


@app.get("/api/tasks")
def list_tasks_endpoint(
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id")
) -> dict:
    return {"tasks": list_tasks(user_id=_require_user_id(x_user_id))}


@app.get("/api/tasks/{task_id}")
def get_task_endpoint(
    task_id: int,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id")
) -> dict:
    task = get_task(task_id, user_id=_require_user_id(x_user_id))
    if not task:
        raise HTTPException(status_code=404, detail="Task not found.")
    return task


@app.post("/api/tasks")
def create_task_endpoint(
    task: TaskIn,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id")
) -> dict:
    return create_task(task.model_dump(), user_id=_require_user_id(x_user_id))


@app.patch("/api/tasks/{task_id}")
def update_task_endpoint(
    task_id: int,
    task: TaskUpdate,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id")
) -> dict:
    updated = update_task(
        task_id,
        task.model_dump(exclude_unset=True),
        user_id=_require_user_id(x_user_id)
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Task not found.")
    return updated


@app.delete("/api/tasks/{task_id}")
def delete_task_endpoint(
    task_id: int,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id")
) -> dict:
    if not delete_task(task_id, user_id=_require_user_id(x_user_id)):
        raise HTTPException(status_code=404, detail="Task not found.")
    return {"status": "deleted"}


@app.post("/api/syllabi/upload")
def upload_syllabus(
    file: UploadFile = File(...),
    course: Optional[str] = Query(default=None),
    format: str = Query(default="json"),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id")
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Upload a PDF file.")

    owner_id = _require_user_id(x_user_id)
    file_bytes = file.file.read()
    events = extract_events_from_pdf_bytes(file_bytes)
    calendar = build_calendar(events)

    record = save_record(
        filename=file.filename,
        file_bytes=file_bytes,
        events=[event.__dict__ for event in events],
        calendar=calendar,
        course=course,
        user_id=owner_id
    )

    if format == "ics":
        calendar_title = course or "Syllabus Calendar"
        ics = calendar_to_ics(calendar, calendar_title)
        return PlainTextResponse(content=ics, media_type="text/calendar")

    return JSONResponse(
        status_code=201,
        content={
            "syllabus_id": record["id"],
            "file_name": record["file_name"],
            "course": record.get("course"),
            "events": record["events"],
            "calendar": record["calendar"]
        }
    )


@app.get("/api/syllabi/{syllabus_id}")
def get_syllabus(
    syllabus_id: str,
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id")
):
    record = get_record(syllabus_id, user_id=_require_user_id(x_user_id))
    if not record:
        raise HTTPException(status_code=404, detail="Syllabus not found.")
    calendar = build_calendar(record["events"])
    return {**record, "calendar": calendar}


@app.get("/api/syllabi/{syllabus_id}/calendar")
def get_calendar(
    syllabus_id: str,
    format: str = Query(default="json"),
    x_user_id: Optional[str] = Header(default=None, alias="X-User-Id")
):
    record = get_record(syllabus_id, user_id=_require_user_id(x_user_id))
    if not record:
        raise HTTPException(status_code=404, detail="Syllabus not found.")

    calendar = build_calendar(record["events"])
    if format == "ics":
        calendar_title = record.get("course") or "Syllabus Calendar"
        ics = calendar_to_ics(calendar, calendar_title)
        return PlainTextResponse(content=ics, media_type="text/calendar")

    return {"calendar": calendar}
