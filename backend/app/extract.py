from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
import os
import re
from typing import Iterable, Optional

import dateparser
import pdfplumber
import requests
from PyPDF2 import PdfReader

MONTH_PATTERN = (
    r"(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|"
    r"sep|sept|september|oct|october|nov|november|dec|december)"
)

DATE_REGEXES = [
    re.compile(rf"\b{MONTH_PATTERN}\s+\d{{1,2}}(?:,\s*\d{{4}})?\b", re.IGNORECASE),
    re.compile(r"\b\d{1,2}/\d{1,2}(?:/\d{2,4})?\b"),
    re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
]

TYPE_KEYWORDS = {
    "exam": ["exam", "midterm", "final"],
    "quiz": ["quiz"],
    "project": ["project", "capstone"],
    "assignment": ["assignment", "homework", "problem set", "pset", "worksheet"],
    "reading": ["reading", "chapter", "pages"],
    "lab": ["lab", "laboratory"]
}

OCR_SPACE_API_URL = "https://api.ocr.space/parse/image"
OCR_SPACE_API_KEY = os.getenv("OCR_SPACE_API_KEY", "helloworld")
OCR_SPACE_TIMEOUT = 20


@dataclass
class ExtractedEvent:
    id: str
    title: str
    date: str
    type: str
    confidence: float
    source_page: Optional[int]
    source_line: Optional[str]


def extract_events_from_pdf_bytes(pdf_bytes: bytes) -> list[ExtractedEvent]:
    pages = _extract_text_pages(pdf_bytes)
    events = _extract_events_from_pages(pages)
    if events:
        return events

    ocr_text = _extract_text_via_ocr_space(pdf_bytes)
    if ocr_text:
        events = _extract_events_from_pages([(1, ocr_text)])
    return events


def _extract_events_from_pages(pages: list[tuple[int, str]]) -> list[ExtractedEvent]:
    events: list[ExtractedEvent] = []
    seen: set[tuple[str, str]] = set()
    now = datetime.utcnow()

    for page_number, page_text in pages:
        for line in _iter_lines(page_text):
            date_matches = _find_dates(line)
            if not date_matches:
                continue

            item_type, keyword_hits = _classify_type(line)
            for date_text in date_matches:
                parsed = dateparser.parse(
                    date_text,
                    settings={
                        "PREFER_DATES_FROM": "future",
                        "RELATIVE_BASE": now,
                        "STRICT_PARSING": True
                    }
                )
                if not parsed:
                    continue

                date_iso = parsed.date().isoformat()
                title = _build_title(line, date_text, item_type)
                if not title:
                    title = "Untitled syllabus item"

                key = (title.lower(), date_iso)
                if key in seen:
                    continue

                confidence = _confidence_score(date_text, keyword_hits, line)
                event = ExtractedEvent(
                    id=f"evt_{len(events) + 1}",
                    title=title,
                    date=date_iso,
                    type=item_type,
                    confidence=confidence,
                    source_page=page_number,
                    source_line=line.strip()
                )
                events.append(event)
                seen.add(key)

    events.sort(key=lambda item: item.date)
    return events


def _extract_text_via_ocr_space(pdf_bytes: bytes) -> str:
    if not OCR_SPACE_API_KEY:
        return ""

    try:
        response = requests.post(
            OCR_SPACE_API_URL,
            files={"file": ("syllabus.pdf", pdf_bytes, "application/pdf")},
            data={
                "apikey": OCR_SPACE_API_KEY,
                "language": "eng",
                "isOverlayRequired": "false",
                "OCREngine": "2"
            },
            timeout=OCR_SPACE_TIMEOUT
        )
        if response.status_code != 200:
            return ""
        payload = response.json()
        parsed_results = payload.get("ParsedResults", [])
        texts = [item.get("ParsedText", "") for item in parsed_results]
        return "\n".join([text for text in texts if text])
    except Exception:
        return ""


def _extract_text_pages(pdf_bytes: bytes) -> list[tuple[int, str]]:
    pages: list[tuple[int, str]] = []
    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        for index, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            pages.append((index, text))

    if any(text for _, text in pages):
        return pages

    reader = PdfReader(BytesIO(pdf_bytes))
    for index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        pages.append((index, text))
    return pages


def _iter_lines(text: str) -> Iterable[str]:
    for raw_line in text.splitlines():
        line = " ".join(raw_line.split())
        if len(line) < 6:
            continue
        yield line


def _find_dates(line: str) -> list[str]:
    matches: list[str] = []
    for pattern in DATE_REGEXES:
        matches.extend(pattern.findall(line))
    return matches


def _classify_type(line: str) -> tuple[str, list[str]]:
    lowered = line.lower()
    matches: list[str] = []
    for item_type, keywords in TYPE_KEYWORDS.items():
        for keyword in keywords:
            if keyword in lowered:
                matches.append(keyword)
                return item_type, matches
    return "other", matches


def _build_title(line: str, date_text: str, item_type: str) -> str:
    cleaned = line.replace(date_text, "").strip(" -:|\t")
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    if cleaned:
        return cleaned
    return item_type.capitalize()


def _confidence_score(date_text: str, keyword_hits: list[str], line: str) -> float:
    score = 0.4
    if keyword_hits:
        score += 0.3
    if re.search(r"\d{4}", date_text):
        score += 0.1
    if len(line) < 80:
        score += 0.05
    if any(token in line.lower() for token in ["due", "deadline", "exam", "quiz"]):
        score += 0.1
    return max(0.0, min(1.0, round(score, 2)))


def build_calendar(events: list) -> dict:
    if not events:
        return {"start_date": None, "end_date": None, "events": []}

    normalized = []
    for event in events:
        if isinstance(event, ExtractedEvent):
            normalized.append(event.__dict__)
        elif isinstance(event, dict):
            normalized.append(event)
        else:
            continue

    if not normalized:
        return {"start_date": None, "end_date": None, "events": []}

    dates = [item.get("date") for item in normalized if item.get("date")]
    if not dates:
        return {"start_date": None, "end_date": None, "events": normalized}

    return {
        "start_date": min(dates),
        "end_date": max(dates),
        "events": normalized
    }


def calendar_to_ics(calendar: dict, title: str) -> str:
    stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//StudyFlow//Syllabus Calendar//EN",
        f"X-WR-CALNAME:{_escape_ics(title)}",
        f"DTSTAMP:{stamp}"
    ]

    for event in calendar.get("events", []):
        event_date = event["date"].replace("-", "")
        uid = event["id"]
        summary = _escape_ics(event["title"])
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{uid}",
                f"DTSTAMP:{stamp}",
                f"DTSTART;VALUE=DATE:{event_date}",
                f"SUMMARY:{summary}",
                "END:VEVENT"
            ]
        )

    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


def _escape_ics(value: str) -> str:
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
