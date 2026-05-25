# Live Assignment Monitor — Implementation Guide

Goal: build an **assignment-centric** view where a teacher picks a class and assignment, sees every student's response on the left as live-updating cards, and sees per-student metrics on the right. Later, a Question selector at the top jumps every card to the same heading.

> Read [`README.md`](./README.md) first for hard rules (stack, naming, no new frameworks).

---

## 1. The UI plan (recap)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Panopticon                          [Scan]  [Mark all seen]  ● Live        │
├─────────────────────────────────────────────────────────────────────────────┤
│  Class ▼  │  Assignment ▼  │  Question ▼ (future)  │  🔍 Search student   │
├─────────────────────────────────────────────────────────────────────────────┤
│  24 students · 3 editing now · avg 412 words · last activity 23s ago        │
├──────────────────────────────┬──────────────────────────────────────────────┤
│  STUDENT RESPONSES (grid)    │  METRICS (selected student)                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ │  Emma Wilson                                 │
│  │ Emma │ │ Liam │ │ Ava  │ │  Words written       847                     │
│  │● live│ │2m ago│ │idle  │ │  Time since edit     12s                     │
│  │excerpt│ │excerpt│ │excerpt│ │  File size           24 KB                   │
│  └──────┘ └──────┘ └──────┘ │  Kind                DRAFT                   │
│                              │  First submitted     9:14 AM                 │
│                              │  ── Future ──                                │
│                              │  AI feedback     [placeholder]               │
│                              │  Originality     [placeholder]               │
│                              │  Grade band      [placeholder]               │
│                              │  vs class avg    [placeholder]               │
│                              │  [Open in Word]                              │
└──────────────────────────────┴──────────────────────────────────────────────┘
```

- **Selection hierarchy:** Class → Assignment → (later) Question.
- **Left ~65%:** one card per student (the latest relevant doc).
- **Right ~35%:** metrics for the selected student. When nothing selected, show class-wide summary stats.
- **Live activity:** cards pulse when a student's `last_modified_at` changes; activity state derived from time-since-modified (`< 60s` = live, `< 5m` = recent, else idle).

### Visual states (card)

| State | Treatment |
|-------|-----------|
| Editing now (< 60s) | Green pulse dot, "live" badge using `--new` / `--new-bg` |
| Recent (1–5 min) | Amber dot (add `--warn: #fbbf24` token) |
| Idle (> 5 min) | Plain muted timestamp |
| Missing | Dashed border, "No file yet" |
| Selected | Left accent border using `--accent` (same pattern as current sidebar) |
| New (unseen) | Existing `NEW` badge pattern |

### Reuse existing tokens & components

- Colors: `--surface`, `--surface2`, `--border`, `--text`, `--muted`, `--accent`, `--new`, `--new-bg` from `src/app.css`. Add `--warn: #fbbf24` if amber is needed.
- `DocPreview.svelte` already handles previewing; the new card uses a slimmed-down inline excerpt powered by the same preview API.

---

## 2. Plan vs current code (gap analysis)

The codebase has already shipped several things the original plan assumed were future work. Verified against the live code on 2026-05-25 after Step 1.

### Already in place — reuse, do not rebuild

| Capability | Where |
|------------|-------|
| `kind: "submitted" \| "working"` on every submission | `server/src/types.ts`, DB column `kind` with index |
| `Summary.by_class` includes `submitted_count` and `working_count` | `server/src/db.ts` → `getSummary()` |
| SSE endpoint streaming change events | `GET /api/events` in `server/src/routes.ts` backed by `EventBus` |
| Typed client-side SSE subscriber with auto-reconnect | `subscribeToEvents` in `src/lib/api.ts` (returns `AppEvent`) |
| Live-connection indicator (pulsing dot) | `.live-dot` in `App.svelte` header |
| Kind filter (Submitted / Working / Both) | `filterKind` in `App.svelte` sidebar |
| Kind badges (DRAFT / TURNED IN) | Sidebar items and `DocPreview` |
| Submission list filterable by class, assignment, student, kind, status | `GET /api/submissions?class=&assignment=&student=&kind=&status=` |
| Stale-request-guarded preview reload + "updated" pill animation | `src/components/DocPreview.svelte` — **do not touch reload logic** |
| Mode toggle (Browse / Live Monitor) and placeholder monitor view | `App.svelte` mode state + `src/views/AssignmentMonitor.svelte` (added Step 1) |

### Genuinely missing — must be built in remaining steps

| Gap | Where it lands | Used by step |
|-----|----------------|---------------|
| `SelectionBar` component (Class → Assignment dropdowns) | `src/components/SelectionBar.svelte` | Step 2 |
| Per-student rollup endpoint (one row per student, latest file) | `GET /api/assignments/:label/:assignment/responses` in `server/src/routes.ts` | Step 3 |
| Word count helper with per-file cache | `server/src/metrics.ts` (uses `mammoth.extractRawText`) | Step 3 |
| Typed client wrapper for responses endpoint | Extend `src/lib/api.ts` (`fetchAssignmentResponses`) | Step 4 |
| `StudentResponseGrid` + `StudentResponseCard` | `src/components/` | Step 5 |
| `MetricsPanel` + `MetricRow` | `src/components/` | Step 6 |
| Patch monitor-view rows from SSE deltas (the global `scheduleRefresh` is too coarse for the grid) | `AssignmentMonitor.svelte` subscribes and patches the array in place | Step 7 |
| `ActivityIndicator` + shared 15s "now" ticker | `src/components/ActivityIndicator.svelte`, `src/lib/metrics.ts` | Step 8 |
| Heading/question structure endpoint | `server/src/structure.ts` + `GET /api/submissions/:id/structure` | Step 9 |
| Optional `scrollToHeading` prop on `DocPreview` | `src/components/DocPreview.svelte` (additive only) | Step 9 |

### Plan claims to forget (false at the time of writing the original plan)

- ~~"Polling-only, no SSE."~~ SSE is shipped on both server and client.
- ~~"Submissions are just `submitted`."~~ `kind` has been live for a while.
- ~~"Class param is `?watch_root_label=`."~~ It is `?class=` (mapped server-side).
- ~~"Need to add stale-guard / silent reload to `DocPreview`."~~ Already there.

---

## 3. Architecture changes

### New files

```
src/
├── views/
│   └── AssignmentMonitor.svelte       # EXISTS (Step 1 placeholder) — fill in Steps 2–9
├── components/
│   ├── SelectionBar.svelte            # NEW — Class / Assignment / Question dropdowns
│   ├── StudentResponseGrid.svelte     # NEW — grid container
│   ├── StudentResponseCard.svelte     # NEW — one student tile with excerpt
│   ├── MetricsPanel.svelte            # NEW — right-side metrics
│   ├── MetricRow.svelte               # NEW — single label/value row
│   ├── ActivityIndicator.svelte       # NEW — pulse dot + live/recent/idle
│   └── DocPreview.svelte              # EXISTS — leave alone (optionally add scrollToHeading in Step 9)
└── lib/
    ├── api.ts                         # EXISTS — has SSE subscriber; EXTEND with new endpoints in Step 4
    └── metrics.ts                     # NEW — formatRelativeTime, activityState

server/src/
├── metrics.ts                         # NEW — wordCount(docxBuffer) etc.
├── structure.ts                       # NEW — extract headings from .docx
└── routes.ts                          # EXTEND with new endpoints
```

### App entry change

`App.svelte` keeps the current Browse view but mounts a mode toggle at the top:

- **Browse** — existing single-doc sidebar UI.
- **Live Monitor** — new `AssignmentMonitor.svelte`.

Default mode = Live Monitor once it ships. Do not delete Browse; teachers may want it for past assignments.

### New API endpoints

Add these to `server/src/routes.ts`. Keep snake_case fields.

#### `GET /api/assignments/:label/:assignment/responses`

One row per **student** for that `(watch_root_label, assignment)`. Picks the latest `.docx` per student (or latest of any extension if no docx). Filter by `kind` query param.

```json
[
  {
    "student": "Emma Wilson",
    "submission_id": "abc123",
    "filename": "Essay.docx",
    "kind": "working",
    "extension": ".docx",
    "size_bytes": 24576,
    "first_seen_at": "2026-05-25T09:14:00.000Z",
    "last_modified_at": "2026-05-25T12:38:48.000Z",
    "word_count": 847,
    "status": "new"
  }
]
```

- Computed by grouping `store.list({ watch_root_label, assignment, kind })` by `student` and reducing to the latest.
- `word_count` cached in-memory keyed by `(submission_id, last_modified_at)`. Recompute only when mtime changes.

#### `GET /api/submissions/:id/structure`

```json
{ "headings": [{ "id": "q1", "level": 1, "text": "Question 1" }, ...] }
```

- Use `mammoth.convertToHtml`, parse the resulting HTML for `h1`–`h3`.
- Cache by `(id, last_modified_at)`.

#### Extend `GET /api/preview/:id` (optional)

Add `word_count` to the response payload when `type === "html"` so cards can render it without a second call. Don't break existing consumers.

### SSE event shape (already emitted by `EventBus`)

Read `server/src/events.ts` (not shown but referenced). Confirm the event payload includes at minimum the affected submission `id` (and ideally `student`, `assignment`, `watch_root_label`, `last_modified_at`). If a field is missing, **add it on the server first** — do not refetch the whole list just because an event told you something changed.

### Client SSE wrapper (`src/lib/events.ts`)

```typescript
export type LiveEvent = {
  type: "submission.updated" | "submission.created" | "submission.deleted";
  submission_id: string;
  watch_root_label?: string;
  assignment?: string;
  student?: string;
  last_modified_at?: string;
};

export function subscribeToEvents(onEvent: (e: LiveEvent) => void): () => void {
  const es = new EventSource("/api/events");
  es.onmessage = (msg) => {
    try { onEvent(JSON.parse(msg.data)); } catch { /* ignore keepalives */ }
  };
  return () => es.close();
}
```

Use this in `AssignmentMonitor.svelte` inside `$effect`. Reconcile updates into the local `responses` array by `submission_id`. Fall back to a 30s poll only if `EventSource.readyState === EventSource.CLOSED`.

---

## 4. Implementation order

Each step is independently mergeable. Don't start step N+1 with step N broken.

### Step 1 — Mode toggle scaffold ✅ DONE (2026-05-25)

- `App.svelte` exposes a segmented `Browse | Live Monitor` toggle in the header (`.mode-toggle`).
- `mode` state defaults to `"browse"`. `AssignmentMonitor` mounts when `mode === "monitor"`.
- Placeholder view lives at `src/views/AssignmentMonitor.svelte` (centered card, links to this doc).
- Browse mode behavior unchanged; SSE, polling, filters, preview all untouched.

### Step 2 — `SelectionBar.svelte`

- Two dropdowns: Class, Assignment.
- Class options from `summary.by_class[].label`.
- Assignment options from `summary.assignments` filtered by `watch_root_label === selectedClass`.
- Changing class clears assignment.
- Emit selection via callback prop or two-way bound props (`$bindable`).
- **Acceptance:** Picking class repopulates assignments; picking assignment fires a callback with `{ class, assignment }`.

### Step 3 — Server: `/api/assignments/:label/:assignment/responses`

- Implement the rollup endpoint described above.
- Add a `wordCount(docxBuffer)`: extract raw text via `mammoth.extractRawText`, split on whitespace, length. Cache in a `Map<string, { mtime: string; count: number }>` keyed by `submission_id`.
- **Acceptance:** Hitting the endpoint returns one row per student with `word_count` populated for `.docx` rows.

### Step 4 — Client: extend `src/lib/api.ts`

Add typed wrapper:

```typescript
export interface StudentResponse {
  student: string;
  submission_id: string;
  filename: string;
  kind: SubmissionKind;
  extension: string;
  size_bytes: number;
  first_seen_at: string;
  last_modified_at: string;
  word_count: number | null;
  status: "new" | "seen";
}

export async function fetchAssignmentResponses(
  cls: string,
  assignment: string,
  kind?: "submitted" | "working"
): Promise<StudentResponse[]> { ... }
```

- **Acceptance:** Function returns typed data when called with valid `(class, assignment)`.

### Step 5 — `StudentResponseGrid` + `StudentResponseCard` (static data)

- Grid: CSS grid, `repeat(auto-fill, minmax(220px, 1fr))`, gap 12px.
- Card: name, activity dot, filename, word count, relative time, mini excerpt.
- Excerpt = first ~200 chars of the docx preview (call existing `/api/preview/:id`, strip HTML, truncate). Lazy-load on render or on hover to avoid hammering the server.
- Selected state via prop, click handler bubbles `select(submission_id)`.
- **Acceptance:** Cards render for current assignment; clicking selects (visual change only).

### Step 6 — `MetricsPanel.svelte` (Phase 1 metrics only)

Render from the selected `StudentResponse`:

| Metric | Source |
|--------|--------|
| Words written | `word_count` |
| Time since last edit | `formatRelativeTime(last_modified_at)` |
| File size | `formatSize(size_bytes)` (already in `api.ts`) |
| Kind | `kind` (DRAFT / TURNED IN badge) |
| First submitted | `formatDate(first_seen_at)` |
| Status | `new` / `seen` |

Below, render placeholder cards for Phase 3 with a "Coming soon" pill:

- AI feedback
- Copy-paste risk (traffic light)
- Grade band (A–C)
- vs class average

When no student selected: show class summary (count, currently editing, avg words, last activity).

**Acceptance:** Selecting a card populates the metrics panel; deselecting shows class summary.

### Step 7 — Live updates for the monitor grid

The app-wide `subscribeToEvents` already exists (`src/lib/api.ts`) and Browse mode debounces a full refresh on every event. That's too coarse for the monitor grid because it would refetch every student's row on every save. Do this instead:

- In `AssignmentMonitor.svelte` add its own `subscribeToEvents` inside `$effect`, unsubscribe on cleanup.
- Each event is a `SubmissionChangedEvent` with `student`, `assignment`, `watch_root_label`, `last_modified_at`.
- Filter to events matching the currently selected `(class, assignment)`. Ignore others.
- For a matching event, find the row in the local `responses` array by `student`; patch its `last_modified_at` (so activity state re-derives) and refetch only that student's word count / excerpt.
- If no matching row exists yet (new student), call `fetchAssignmentResponses` once to pick up the addition.
- **Acceptance:** Saving a watched docx makes only the affected card pulse and recompute its metrics within a few seconds. Other cards do not refetch.

### Step 8 — Activity indicator

- `src/lib/metrics.ts` exports:
  ```typescript
  export type ActivityState = "live" | "recent" | "idle";
  export function activityState(lastModifiedIso: string, nowMs = Date.now()): ActivityState {
    const age = nowMs - Date.parse(lastModifiedIso);
    if (age < 60_000) return "live";
    if (age < 5 * 60_000) return "recent";
    return "idle";
  }
  ```
- `ActivityIndicator.svelte`: animated dot, color per state, optional label.
- Re-derive every 15s via a single shared `$state(Date.now())` ticker so cards don't each schedule timers.
- **Acceptance:** Just-saved file shows green pulse; after 1 minute fades to amber; after 5 minutes goes idle.

### Step 9 — Question selector (heading sync)

- Server: implement `/api/submissions/:id/structure`.
- Client: when assignment selected, fetch structure for **one representative** submission (or union across students — start with one) to populate the dropdown.
- On Question change, broadcast `selectedHeading` to all visible cards. Each card scrolls its mini-excerpt iframe/container to the heading.
- Extend `DocPreview.svelte` with an optional `scrollToHeading?: string` prop that finds `[data-heading-id]` and scrolls into view. Add the `data-heading-id` attribute during the mammoth-to-HTML post-processing step on the server.
- **Acceptance:** Picking "Question 2" scrolls all cards (and the main preview if open) to that heading.

### Step 10 — Phase 3 placeholders → real (out of scope for this guide)

Each future metric becomes a new endpoint + a new card in `MetricsPanel`. Do not stub fake data in the UI — show "Not available yet" until the endpoint exists.

---

## 5. Open product decisions (ask the user, don't guess)

1. **Multiple files per student per assignment** — show only the latest `.docx`, or expose a small file picker on the card?
2. **Default selection** — auto-select the first student, or start with class summary?
3. **Browse mode** — keep as a second tab forever, or retire once Live Monitor is mature?
4. **Default `kind` filter** — Live Monitor defaults to `working` (live drafts). Should the toggle allow `both` simultaneously?

---

## 6. Definition of done

The Live Monitor feature is complete when:

- [ ] Mode toggle exists; Browse view still works unchanged.
- [ ] Class + Assignment selection is fully wired to existing summary data.
- [ ] One card per student renders with name, excerpt, word count, activity state.
- [ ] Metrics panel shows Phase 1 metrics for the selected student and class summary when none selected.
- [ ] SSE subscription updates cards within a few seconds of a file save.
- [ ] Question selector jumps cards to the chosen heading.
- [ ] No new top-level dependencies were added.
- [ ] All new fields on API responses are `snake_case`.
- [ ] This doc updated to reflect any deviations from the plan.
