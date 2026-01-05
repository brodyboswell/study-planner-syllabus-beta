# Frontend Spec (Simple Modern)

## 1) Visual direction
Tone: calm, focused, and utilitarian. Use generous whitespace, clear hierarchy, and minimal chrome.

Typography:
- Headings: "Space Grotesk", 600-700 weight.
- Body: "Work Sans", 400-500 weight.
- Numbers and stats: "Space Grotesk" for consistency.

Color system (no purple):
- Ink: #1B1E1F
- Muted ink: #5E6668
- Surface: #F7F6F3
- Card: #FFFFFF
- Accent: #3A6F5D (green)
- Warning: #E07A5F (warm orange)
- Border: #E6E2DA

Background:
- Subtle gradient on the page background:
  - from #F7F6F3 to #EEEAE2
- Optional faint noise texture for depth.

## 2) Layout and navigation
Desktop:
- Top bar with product name and primary actions.
- Primary nav as a simple horizontal tab row: Dashboard, Calendar, Tasks, Insights.
- Content area uses a 12-column grid with 24px gutters.

Mobile:
- Sticky top bar with a compact tab row.
- Calendar and tasks become stacked sections.

## 3) Key screens
Dashboard (home):
- One sentence status line.
- Three small cards: upcoming deadlines, risk summary, study hours this week.
- A simple trend chart (7 or 14 days).
- "Import syllabus" call-to-action at the top.

Calendar:
- Week view by default.
- Deadlines as solid bars with a label.
- Study blocks as light pills with time range.
- Hover reveals details, click opens edit drawer.

Tasks:
- List with minimal filters (course, due week).
- Risk badge with short label (Low, Medium, High).
- Inline edit for estimate and importance.

Insights:
- Two charts: completion trend and missed deadlines.
- Recommendations list with one-line actions.

Syllabus import:
- Drag-and-drop upload area.
- Progress state with steps: Uploading -> Extracting -> Review.
- Review table with inline edit, accept, and reject.
- Confirm button to create tasks and calendar entries.

## 4) Component design
Cards:
- 8px radius, 1px border, no heavy shadows.
- Title, stat, and a one-line note.

Buttons:
- Primary: Accent background, white text.
- Secondary: Transparent with border.
- Destructive: Warning background.

Inputs:
- Full-width, 12px padding, subtle border.
- Use helper text instead of heavy labels.

Badges:
- Simple pill with small text and light tint.

## 5) Motion
Keep animation subtle and purposeful:
- Page load: 120ms fade-in.
- Staggered reveal for list items (60ms offset).
- Hover: 100ms color shift for buttons.

## 6) Accessibility
- Minimum 4.5:1 contrast for text.
- Clear focus ring in Accent color.
- Avoid color-only communication for risk and status.

## 7) CSS variables (starter)
:root {
  --ink: #1B1E1F;
  --ink-muted: #5E6668;
  --surface: #F7F6F3;
  --card: #FFFFFF;
  --accent: #3A6F5D;
  --warning: #E07A5F;
  --border: #E6E2DA;
  --radius: 8px;
}
