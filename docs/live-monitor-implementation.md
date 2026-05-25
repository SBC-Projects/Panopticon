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

All shipped 2026-05-26 in the same change as Steps 2–9. See §4 for per-step notes.

| Gap | Where it landed | Step |
|-----|----------------|------|
| `SelectionBar` component (Class → Assignment dropdowns) | `src/components/SelectionBar.svelte` | Step 2 ✅ |
| Per-student rollup endpoint (one row per student, latest file) | `GET /api/assignments/:label/:assignment/responses` in `server/src/routes.ts` | Step 3 ✅ |
| Word count + excerpt helper with per-file cache | `server/src/metrics.ts` (uses `mammoth.extractRawText`); returns `{ word_count, excerpt }` so cards don't need a second fetch | Step 3 ✅ |
| Typed client wrapper for responses endpoint | `src/lib/api.ts` (`fetchAssignmentResponses`, `StudentResponse`) | Step 4 ✅ |
| `StudentResponseGrid` + `StudentResponseCard` | `src/components/` | Step 5 ✅ |
| `MetricsPanel` + `MetricRow` | `src/components/` | Step 6 ✅ |
| Patch monitor-view rows from SSE deltas | `AssignmentMonitor.svelte` subscribes and patches the matching student row in place | Step 7 ✅ |
| `ActivityIndicator` + shared 15s "now" ticker | `src/components/ActivityIndicator.svelte`, `src/lib/metrics.svelte.ts` (renamed from `.ts` — Svelte 5 runes need a `.svelte.ts` file) | Step 8 ✅ |
| Heading/question structure endpoint | `server/src/structure.ts` + `GET /api/submissions/:id/structure` | Step 9 ✅ |
| `data-heading-id` injection on preview HTML + `scrollToHeading` prop on `DocPreview` | `injectHeadingIds()` in `structure.ts` post-processes mammoth HTML; `DocPreview` accepts optional `scrollToHeading` | Step 9 ✅ |

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

### Step 2 — `SelectionBar.svelte` ✅ DONE (2026-05-26)

- Single bar with **Class, Assignment, Question, Kind, Search** controls; all bound to `$bindable` props on `AssignmentMonitor.svelte`.
- Class options sourced from `summary.by_class[].label`; Assignment options filtered by `watch_root_label === selectedClass`, deduped, sorted.
- Changing class clears `selectedAssignment` if it doesn't exist under the new class.
- Question dropdown disabled while `headings.length === 0`; indented by heading `level`.
- Kind dropdown defaults to `working` (live drafts) per §5 decision.

### Step 3 — Server: `/api/assignments/:label/:assignment/responses` ✅ DONE (2026-05-26)

- Endpoint implemented in `server/src/routes.ts`. Decodes URL-encoded `:label` and `:assignment`; honours optional `?kind=submitted|working`.
- `pickLatestPerStudent` reduces `store.list(...)` results to one row per student, preferring the latest `.docx`, falling back to the latest file of any extension (per §5 decision).
- `getDocStats(submissionId, absolutePath, ext, mtimeIso)` in `server/src/metrics.ts` returns `{ word_count, excerpt }` from a single `mammoth.extractRawText` pass. Cached by `submission_id`; entry invalidates when `mtimeIso` changes. **Excerpt is bundled** in the same cache so cards don't need to call `/api/preview/:id` just to render an excerpt.
- Output sorted by `student.localeCompare`.
- **Verified live (2026-05-26):** Hit `/api/assignments/7%20Digital%20Technology%20Class%203/7DT%20week%203%20homework/responses?kind=working` → 23 rows, every `.docx` has `word_count` populated and an excerpt.

### Step 4 — Client: extend `src/lib/api.ts` ✅ DONE (2026-05-26)

- Added `StudentResponse` interface (with `excerpt: string` in addition to the originally-planned fields).
- Added `fetchAssignmentResponses(cls, assignment, kind?)` using URL-encoded path params.
- Added `Heading` type + `fetchStructure(submissionId)` for Step 9.

### Step 5 — `StudentResponseGrid` + `StudentResponseCard` ✅ DONE (2026-05-26)

- Grid: `repeat(auto-fill, minmax(220px, 1fr))`, gap `0.75rem`. Loading and empty states centralised in the grid component (avoids each parent re-implementing them).
- Card shows: student name, `ActivityIndicator` (with label), kind badge, NEW badge if unseen, word count, 4-line clamped excerpt, filename, relative time.
- **Deviation from plan:** excerpts come **bundled in the responses payload** (server-side cache) rather than each card fetching `/api/preview/:id` separately. Single fetch per assignment switch instead of N+1.
- Selection toggles on re-click (clicking the selected card deselects).

### Step 6 — `MetricsPanel.svelte` ✅ DONE (2026-05-26)

- `MetricRow.svelte` renders a labelled value with placeholder styling (italic + muted) when used for Phase-3 cards. Accepts a snippet child for custom values (e.g. kind badge).
- Phase 1 metrics: Words written, Time since edit, File size, Kind badge, First seen, Status.
- Phase 3 placeholders ("Not available yet"): AI feedback, Copy-paste risk, Grade band, vs class average.
- Class summary when no student selected: student count, live + recent counts, average words (only over rows with a `word_count`), latest activity with `ActivityIndicator`.
- "Open in Word" button uses the existing `openInApp` API.
- Panel is `position: sticky; top: 1rem` so it stays in view while scrolling the grid.

### Step 7 — Live updates for the monitor grid ✅ DONE (2026-05-26)

- `AssignmentMonitor.svelte` opens its own `subscribeToEvents` inside `$effect`, unsubscribes on cleanup.
- Events filtered by `watch_root_label === selectedClass && assignment === selectedAssignment && (kind matches OR all-kinds)`.
- For matching events, `refreshOneByStudent(student)` calls the rollup endpoint once and splices the single matching row back into `responses`. New students added at the end and re-sorted.
- A `fetchSeq` ticket discards late responses if the user changed selection mid-flight.
- **Trade-off vs original plan:** the spec called for "fetch only that student's word count / excerpt". Since the only endpoint that returns those is the assignment-wide rollup, we refetch the rollup and pick the row server-side caching makes it cheap (`getDocStats` returns the cached value for every row whose mtime hasn't changed). A per-student endpoint isn't worth the extra surface area yet.

### Step 8 — Activity indicator ✅ DONE (2026-05-26)

- `src/lib/metrics.svelte.ts` exports `ActivityState`, `activityState()`, `formatRelativeTime()`, and `now` (a `NowTicker` singleton).
- **Filename deviation:** path is `metrics.svelte.ts`, not `metrics.ts`, because Svelte 5 runes (`$state`) only work inside `.svelte` / `.svelte.ts` modules. Pure helpers could split into a plain `.ts` but co-locating is simpler — the singleton needs runes, and components import the helpers from the same place anyway.
- `NowTicker.value` lazily starts a single 15s `setInterval` on first read (never stops; single-page lifetime). All components subscribe by reading `now.value` inside `$derived` / templates.
- `ActivityIndicator.svelte`: animated dot via `act-pulse` keyframes for "live"; uses `--warn` for "recent" (new token added to `src/app.css`).
- Used in `StudentResponseCard` and the class-summary row of `MetricsPanel`.

### Step 9 — Question selector (heading sync) ✅ DONE (2026-05-26, partial)

- Server: `GET /api/submissions/:id/structure` returns `{ headings: [{ id, level, text }, ...] }`. Cached per `(id, mtimeIso)`.
- `injectHeadingIds()` post-processes mammoth's HTML on every `/api/preview/:id` response, tagging `<h1>`–`<h3>` with deterministic `data-heading-id` slugs (same algorithm as `parseHeadings`, so ids match the structure endpoint).
- Client: when responses arrive, the monitor view fetches the structure of **one representative** docx (the first row with `extension === ".docx"`) to populate the Question dropdown.
- `DocPreview.svelte` accepts an optional `scrollToHeading?: string` prop. A `$effect` queries `[data-heading-id="..."]` (with `CSS.escape`) and calls `scrollIntoView({ behavior: "smooth" })`.
- **Limitation not yet addressed:** `StudentResponseCard` currently shows only a plain-text excerpt (not the full HTML), so `selectedHeading` is captured in `SelectionBar` and plumbed through but **does not currently scroll the cards themselves**. It's wired ready for the next iteration — either (a) cards switch to a mini HTML preview with `scrollToHeading`, or (b) a new endpoint returns text scoped to a specific heading. The full `DocPreview` (used in Browse mode) is already heading-aware.

### Step 10 — Phase 3 placeholders → real (out of scope for this guide)

Each future metric becomes a new endpoint + a new card in `MetricsPanel`. Do not stub fake data in the UI — show "Not available yet" until the endpoint exists.

---

## 5. Open product decisions

Resolved with defaults on 2026-05-26 (override anytime — these are easy to flip).

1. **Multiple files per student per assignment** — pick latest `.docx`, fall back to latest of any extension. No per-card file picker yet. _Defer the picker until a teacher actually hits a multi-file case._
2. **Default selection** — no student selected; right panel shows the class snapshot. Clicking a card selects; clicking again deselects.
3. **Browse mode** — keep both tabs indefinitely. Browse is still the only way to use full filters + the docx preview pane.
4. **Default `kind` filter** — `working` (live drafts). The dropdown includes `submitted`, `working`, `both`.

---

## 6. Definition of done

The Live Monitor feature is complete when:

- [x] Mode toggle exists; Browse view still works unchanged.
- [x] Class + Assignment selection is fully wired to existing summary data.
- [x] One card per student renders with name, excerpt, word count, activity state.
- [x] Metrics panel shows Phase 1 metrics for the selected student and class summary when none selected.
- [x] SSE subscription updates cards within a few seconds of a file save (single-row patch, not a full grid refetch).
- [ ] Question selector jumps cards to the chosen heading. _Selector + plumbing shipped; cards don't render full HTML yet so the scroll only applies to the Browse-mode preview. See Step 9 note._
- [x] No new top-level dependencies were added.
- [x] All new fields on API responses are `snake_case`.
- [x] This doc updated to reflect any deviations from the plan.
