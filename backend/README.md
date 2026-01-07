# Study Planner Backend

A free-to-run backend that ingests syllabus PDFs, extracts dated items, and outputs a calendar.

## Features
- Upload syllabus PDFs
- Extract assignments/exams with rule-based parsing (no paid APIs)
- Return JSON events or an `.ics` calendar
- Local storage for uploaded files and extracted events
- SQLite persistence for tasks and syllabus data

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Data is stored in `backend/storage/app.db`.

If you run the frontend on a different port, set:
`ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173`

## API

### Upload PDF
`POST /api/syllabi/upload?course=CS101&format=json`

Form-data:
- `file`: PDF file

Headers (required):
- `X-User-Id`: user identifier (e.g., Supabase user id)

Response:
- `201` JSON with `syllabus_id`, `events`, and `calendar`

For calendar output:
`POST /api/syllabi/upload?format=ics`

### Fetch syllabus
`GET /api/syllabi/{syllabus_id}`

### Fetch calendar
`GET /api/syllabi/{syllabus_id}/calendar?format=ics`

### Tasks
- `GET /api/tasks`
- `GET /api/tasks/{task_id}`
- `POST /api/tasks`
- `PATCH /api/tasks/{task_id}`
- `DELETE /api/tasks/{task_id}`

Tasks and syllabi are scoped by `X-User-Id` and require a signed-in user.

## Notes
- Extraction is text-based; scanned PDFs use free OCR.Space as a fallback.
- For higher limits, set `OCR_SPACE_API_KEY` to your free OCR.Space key.
- No external paid APIs are required.
