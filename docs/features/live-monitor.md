# Live Assignment Monitor — Implementation Guide

Goal: build an **assignment-centric** view where a teacher picks a class and assignment, sees every student's response on the left as live-updating cards, and sees per-student metrics on the right. Later, a Question selector at the top jumps every card to the same heading.

> Read [`../conventions.md`](../conventions.md) first for hard rules (stack, naming, no new frameworks) and [`../architecture.md`](../architecture.md) for the system overview. This file is the design + build log for the Live Monitor view only.

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
- For matching `submission-changed` events, `refreshOneByStudent(student)` calls the rollup endpoint once and splices the single matching row back into `responses`. New students added at the end and re-sorted.
- For matching `submission-deleted` events (added 2026-05-26, §4.6), the row whose `submission_id` matches `event.id` is spliced out of `responses` directly — no refetch needed. If the deleted row was selected, `selectedSubmissionId` is cleared so the metrics panel falls back to the class summary.
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

## 4.5 Phase 2 — Roster + empty-state UX (shipped 2026-05-26)

The first cut of the Live Monitor (Steps 1–9) only showed rows that already had a `Submission` in the DB. In the wild this hid two real cases:

- **Empty-but-real files.** A `Submitted` file might be 0 bytes on disk (OneDrive Files-On-Demand placeholder) or parse-cleanly-but-empty (SharePoint coauthor template that hasn't been pulled down yet). The card just rendered blank.
- **Missing students.** If a student never started, or only saved a `Working` draft, they simply weren't in the grid at all — the teacher had no way to see "Bear hasn't done anything" without flipping filters.

Both ship as one change because they share infrastructure (the `ExcerptStatus` enum + `roster.ts` helpers).

### What changed

| Surface | Change |
|---------|--------|
| `server/src/metrics.ts` | `DocStats` now carries `excerpt_status: ExcerptStatus`. Codes: `ok`, `empty_body`, `not_downloaded`, `missing`, `unsupported_ext`, `parse_error`, `not_submitted`. Cache key includes file size so a 0-byte → real-bytes transition invalidates the entry even if mtime didn't change. Parse failures are `console.warn`-logged with the basename instead of silently returning empty. |
| `server/src/preview.ts` | `PreviewResult` gains a `type: "empty"` variant with `reason: "not_downloaded" \| "empty_body"` and a user-facing `message`. Read failures and mammoth conversion failures log to stderr. |
| `server/src/roster.ts` (new) | `getClassRoster(config, label, kind?)` — union of immediate-subfolder names across every watch root sharing the class label. `findDraftElsewhere(store, label, student, currentKind, currentAssignment)` — finds the student's "best match" submission in the OPPOSITE kind, preferring same root-assignment family (first ` / `-separated segment) then most-recent fallback. |
| `server/src/routes.ts` | `/assignments/:label/:assignment/responses` adds two enrichments: (1) every row now carries `assignment`, `excerpt_status`, and an optional `draft_elsewhere` pointer (only set when the row's own content is empty and the opposite kind has something); (2) after picking the latest per student, the roster is merged in as `excerpt_status: "not_submitted"` placeholder rows. Placeholders have an empty `submission_id` and zero-value file fields. |
| `src/lib/api.ts` | Mirrors the server: `ExcerptStatus` union, `DraftElsewhere` interface, `StudentResponse.assignment`, `StudentResponse.excerpt_status`, `StudentResponse.draft_elsewhere`. `PreviewResponse` gains the `empty` variant. |
| `src/components/StudentResponseCard.svelte` | Root element is now `<div role="button">` not `<button>` (so the inline "View draft →" can be a real nested `<button>`). Renders per-status messaging (`emptyMessage` derived). When the current row is empty and `draft_elsewhere` is set, shows an inline preview block (excerpt of the draft) + a one-click "View draft →" jump button. Roster placeholders get a dashed border, `NO SUBMISSION` badge, and no activity dot. |
| `src/components/StudentResponseGrid.svelte` | `each` key falls back to `roster:${student}` when `submission_id` is empty (placeholders share the empty string). Forwards `onJumpToDraft` down to each card. |
| `src/components/MetricsPanel.svelte` | Class snapshot now shows `submitted_count / student_count` ("With a file here") and a separate `not_submitted_count` row when > 0. |
| `src/components/DocPreview.svelte` | Renders the new `empty` preview variant with a two-button row: "Re-check file" (forces a manual reload) and "Open in Word". Adds a `not-synced` class when `reason === "not_downloaded"` so the box gets a warm border. |
| `src/views/AssignmentMonitor.svelte` | `loadHeadings` skips roster placeholders. `classSummary` derived state separates submitted vs not-submitted and only counts real rows for live/recent/words. New `handleJumpToDraft(draft)` flips `selectedKind`, `selectedAssignment` (if different), and `selectedSubmissionId` so the targeted card lights up after the next fetch. |
| `package.json` | `dev:server` is now `tsx watch server/src/index.ts` so server-side edits hot-reload during development. |

### What we ruled out

Two parallel investigations were done before settling on the UX-only fix above. Both ruled out for now:

- **Microsoft Graph API.** Tested with the Microsoft-published Graph PowerShell SDK client id + device code flow (`scratch-probe-graph.mjs`). Blocked at sign-in by `AADSTS90097` — tenant requires admin consent for the requested scopes. Will revisit if/when IT grants consent. The probe script is gitignored (`scratch-*` prefix) so a future agent can pick it up.
- **Word COM automation.** A round of probe scripts (deleted, not committed) opened the same docx via PowerShell COM and compared the extracted text to what `mammoth` saw. They returned identical content — confirming that when `mammoth` reports "empty body" the file genuinely is empty on disk. Word's GUI is showing the live SharePoint coauthor copy, which neither `fs.readFileSync` nor Word COM can reach without going through Graph. No advantage to building a COM bridge.

### Card empty-state copy (for reference)

The card derives one of these messages based on `excerpt_status` and whether `draft_elsewhere` is set. Keep the tone factual; never blame the student.

| Status | Has draft elsewhere? | Message |
|--------|----------------------|---------|
| any empty status | yes | `Empty here. Student has a {N-word}{Working draft\|turned-in copy} — click below to jump to it.` |
| `not_downloaded` | no | `OneDrive hasn't downloaded this file to your machine yet (0 bytes locally). Right-click → Always keep on this device, or wait for sync.` |
| `empty_body` | no | `Local copy is empty. Either the student really hasn't typed anything in this version, or OneDrive hasn't pulled the latest SharePoint state yet.` |
| `missing` | no | `File is no longer on disk.` |
| `parse_error` | no | `Couldn't read this document. Open in Word to inspect.` |
| `unsupported_ext` | no | `Preview not available for .{ext} files.` |
| `not_submitted` (submitted view) | no | `Not turned in yet.` |
| `not_submitted` (working view) | no | `Hasn't started this assignment yet.` |

### Verification recipe

1. `npm run dev`. Open a class + assignment where you know at least one Submitted file is 0 bytes on disk (or rename one temporarily).
2. Card for that student renders with the **dashed border + warn-toned message** describing the empty state.
3. If the same student has a non-empty Working draft, the card shows the draft excerpt and a **`View draft →`** button.
4. Click the jump button → `selectedKind` flips to `working`, the grid refetches, that student's card is selected.
5. Pick a class where someone enrolled has no `Submitted` file at all. Their card appears as a roster placeholder (`NO SUBMISSION`).
6. Edit a draft on disk. Within ~3 s the matching card pulses and word count updates (Step 7 SSE path still works; no full grid refetch).
7. `npm run typecheck` passes.

---

## 4.6 Phase 2.5 — `submission-deleted` event (in progress, 2026-05-26)

The watcher currently emits `submission-changed` on chokidar `add` / `change` but ignores `unlink`. If a teacher removes a file from OneDrive, the row stays in the DB and the card stays on screen forever. This phase wires up the missing delete path.

### Goal

When a watched file disappears from disk, the row is removed from SQLite and every connected client is told to drop that submission. The card disappears within a few seconds, the metrics panel falls back to the class summary if the deleted card was selected, and the doc-stats / structure caches don't leak the orphaned id.

### Non-goals

- No "trash" / undo. Delete is permanent; if the file reappears the next chokidar `add` will re-insert it with a fresh `first_seen_at`.
- Not handling a watch root being unmounted wholesale (chokidar fires per-file `unlink`, so we just react file-by-file).
- No retention of historical "this student turned this in once and then it vanished" state. That's a different feature.

### Gap analysis vs current code

| Surface | Today | Needed |
|---------|-------|--------|
| `server/src/events.ts` `AppEvent` union | Only `SubmissionChangedEvent`. | Add `SubmissionDeletedEvent`. |
| `server/src/db.ts` `SubmissionStore` | `upsertFromFile`, `getById`, `markSeen` only. No deletion. | Add `deleteById(id)` returning the deleted row. |
| `server/src/watcher.ts` | Listens on `add`/`change` via `scheduleProcess` (1500 ms debounce). No `unlink` handler. Watch-root resolution lives inline inside `processFile`. | Listen on `unlink` immediately (no debounce — the file is already gone). Extract `resolveWatchRoot(filePath)` for reuse and to make it unit-testable. |
| `server/src/metrics.ts` | `invalidateDocStats(id)` exists. | No code change — just call it from the watcher delete path. |
| `server/src/structure.ts` | No invalidator exposed; cache leaks ids forever. | Export `invalidateStructure(id)`. |
| `server/src/index.ts` | Logs `New <kind>: ...` from `onNew`. | Add a parallel `onDeleted` callback that logs `Deleted: [<class>] <student> — <assignment> / <filename>` in the same shape. |
| `src/lib/api.ts` `AppEvent` union | Mirrors only the changed variant. | Mirror the new delete variant. |
| `src/views/AssignmentMonitor.svelte` `handleEvent` | Switch on `event.type === "submission-changed"` only. | Handle `submission-deleted`: remove the row whose `submission_id === event.id` from `responses`; if it was the selected row, clear `selectedSubmissionId`. |
| `src/App.svelte` (browse mode) | `scheduleRefresh()` on any event. | No code change — the debounced refresh already reconciles deletions. |
| `docs/reference/api.md` SSE section | Lists only `submission-changed`. | Add the delete variant. |
| `docs/reference/data-model.md` | Store surface mentions upsert/list/getById/mark-seen. Invariant §5 claims "No row is ever deleted by the watcher." | Add `deleteById` to the surface; update or amend invariant 5 (watcher now deletes on `unlink`). |
| `docs/features/live-monitor.md` Step 7 | "patches the matching student row in place" — only changes. | One-line note that deletes remove the row. |

### Event shape

Keep it minimal — only the fields the client needs to filter and reconcile:

```ts
export interface SubmissionDeletedEvent {
  type: "submission-deleted";
  id: string;
  student: string;
  assignment: string;
  watch_root_label: string;
}
```

**Decisions on field set:**

- **No `kind`.** The monitor view reconciles by `submission_id`, not by kind — if a row with this id is in `responses`, it's the one that was deleted regardless of the current `selectedKind` filter. Adding `kind` would be dead weight on the wire and pull the schema further from the spec.
- **No `filename` / `last_modified_at`.** Nothing in either consumer (the monitor reconciler, the browse-mode debounced refresh) needs these post-delete. They only appear in `submission-changed` because the `onNew` log line uses them; the parallel `Deleted` log line is built from the row returned by `deleteById` (which has every column), not from the event payload.
- **Match `snake_case`.** Same convention as `submission-changed`.

### Step-by-step plan

Each step is independently mergeable; run `npm run typecheck` and `npm test` between them.

1. **Server event union** — extend `AppEvent` in `server/src/events.ts` with `SubmissionDeletedEvent`. No runtime change yet; just shape.
2. **Store `deleteById`** — `SELECT ... WHERE id = ?`, then `DELETE FROM submissions WHERE id = ?`. Return the SELECT row (or undefined if there wasn't one). Update the schema doc table.
3. **Extract `resolveWatchRoot`** — pull the inline `find((r) => filePath === r.path || filePath.startsWith(r.path + path.sep))` into a named function in `watcher.ts` (or a small helper module). Reuse it from both `processFile` and the new delete handler. Add a `*.test.ts` covering: exact-match, child-path match, non-match returns `undefined`, sibling-prefix collision (`.../Submitted files` vs `.../Submitted files (copy)` must not match the latter).
4. **`structure.ts` invalidator** — add `export function invalidateStructure(id: string)`. Mirror the docstring style on `invalidateDocStats`.
5. **Watcher `unlink` handler** — add `this.watcher.on("unlink", (p) => this.processDelete(p))`. `processDelete` runs synchronously:
   - `resolveWatchRoot(filePath)` → if none, ignore.
   - `parseSubmissionPath(root.path, filePath)` → if null, ignore (lock file, OneDrive sidecar).
   - `submissionId(root.path, parsed.relative_path)`.
   - `store.deleteById(id)` → if undefined (we never tracked this file), ignore.
   - `invalidateDocStats(id)` + `invalidateStructure(id)`.
   - Build the event payload from the returned row + `events.emit({ type: "submission-deleted", ... })`.
   - Call `this.onDeleted?.(row)` so `index.ts` can log it.
6. **`onDeleted` log in `index.ts`** — pass a second callback to `SubmissionWatcher` that prints `Deleted: [<watch_root_label>] <student> — <assignment> / <filename>` (single line, mirrors the existing `New <kind>:` line).
7. **Client event union** — mirror the new variant in `src/lib/api.ts`.
8. **Monitor reconciliation** — in `AssignmentMonitor.svelte`, refactor `handleEvent` into a small switch on `event.type`:
   - `submission-changed` → existing behaviour.
   - `submission-deleted` → guard by `watch_root_label === selectedClass && assignment === selectedAssignment`, splice the row out of `responses` (match by `submission_id`), and clear `selectedSubmissionId` if it matches the deleted id.

   Browse mode (`App.svelte`) stays as-is — `scheduleRefresh()` on any event reconciles deletes for free.
9. **Docs** — update `api.md` SSE section, `data-model.md` store surface + invariant 5, and the Step 7 note here.

### Decisions made beyond the spec

- **Extract `resolveWatchRoot`.** The inline `find(...)` is now used in two places and the unit test for it pins down the sibling-prefix bug class.
- **No debounce on deletes.** Chokidar's `unlink` is typically a single deterministic event per file; the file is gone, there's nothing to coalesce, and the spec explicitly says react immediately.
- **No new field on the event payload.** Per the bullet above.
- **`invalidateStructure` added even though only the delete path needs it.** Symmetry with `invalidateDocStats`; future cache flushes get a hook without re-touching `structure.ts`.

### Verification recipe

**Vitest (pure helpers):**

```powershell
npm test
```

Adds tests for the extracted `resolveWatchRoot`. Existing 33 tests must stay green.

**Manual (browser):**

1. `npm run dev`. Open http://localhost:5173, switch to Live Monitor.
2. Pick a real class + assignment that has at least one student card.
3. Note one student's card; click it so it's selected (right panel shows their metrics).
4. In Windows Explorer, delete (or move out of the watch root) the `.docx` file that backs that card.
5. **Expected:** within ~3 seconds the card disappears from the grid, the metrics panel switches back to the class summary, and the server log prints a single `Deleted: [...] <student> — <assignment> / <filename>` line.
6. Repeat without first selecting — card just disappears.
7. Switch to Browse mode, delete another file; **expected:** the debounced refresh removes the row from the sidebar within ~1 s of the SSE event.
8. Confirm `curl -N http://127.0.0.1:8765/api/events` (separate terminal) shows a `submission-deleted` event with `id`, `student`, `assignment`, `watch_root_label` populated.

### Definition of done

- [ ] `AppEvent` union extended on both server and client; type-exhaustive switch in `AssignmentMonitor.handleEvent`.
- [ ] `SubmissionStore.deleteById` lands + is referenced from `watcher.ts` only.
- [ ] `resolveWatchRoot` extracted + has its own `*.test.ts`.
- [ ] `invalidateDocStats(id)` and `invalidateStructure(id)` both called on delete.
- [ ] Server logs a `Deleted: ...` line mirroring the existing `New <kind>:` line.
- [ ] `api.md`, `data-model.md`, and this file all reflect the new event + method.
- [ ] `npm run typecheck` and `npm test` both green; test count goes from 33 → 33 + N (where N covers `resolveWatchRoot`).
- [ ] Manual recipe above produces the card-disappears-within-3-seconds behaviour.

---

## 4.7 Phase 3 — Response-inspector modal (planned, 2026-05-27)

The grid + right-rail metrics work great for "scan the wall", but the rail can't show the actual document the student wrote — only a 4-line excerpt on the card. Browse mode has full `DocPreview`, but switching modes loses the live grid context (selected class/assignment/filter, who's editing right now, the "live" pulse animations).

Goal: clicking a student card opens a **modal overlay** with the full `DocPreview` for that student's file plus a compact metrics column, without leaving the Live Monitor view. The grid stays mounted under the modal so the live state is preserved; SSE updates continue to patch cards underneath.

### Goal (one paragraph)

In Live Monitor, clicking any non-placeholder student card opens a centered modal showing (a) the full `DocPreview` for that submission — same mammoth HTML, same stale-guard / silent-reload / heading-scroll behaviour Browse mode already gives us — and (b) a slim metrics column to the right of the preview with the same Phase 1 metrics the right rail shows. Esc / X / backdrop click closes. The grid + right rail underneath are untouched; closing returns the teacher to exactly the state they were in.

### Non-goals

- No new endpoints, no new server-side caches, no schema changes. The modal is a pure client recomposition of state that's already on `StudentResponse` plus the existing `/api/preview/:id` route.
- No new top-level dependencies (per `conventions.md`).
- No replacement of the right-rail `MetricsPanel`. Both surfaces show metrics; the rail keeps working for "I want to see numbers without dimming the grid".
- No edit affordances. This is read-only inspection plus "Open in Word" (already in `DocPreview`).
- No multi-doc tabs inside the modal. One student, one file at a time (the latest-per-student already chosen by `pickLatestPerStudent`).
- No URL / deep-link for the inspector. There's no router in the app and we're not adding one.

### Gap analysis vs current code

| Surface | Today | Needed |
|---------|-------|--------|
| `src/components/DocPreview.svelte` | Accepts `submission: Submission \| null`, handles initial-load / silent-reload / mammoth-HTML / binary / empty / unsupported / error variants, scrolls to heading via `data-heading-id`. | **No change.** Used verbatim. The component already covers everything the modal needs. |
| `src/components/MetricRow.svelte` | Single label/value row used inside `MetricsPanel`. | **No change.** Reused inside the modal's metrics column. |
| `src/components/StudentResponseCard.svelte` | Clickable `.card` with `data-submission-id`; roster placeholders non-interactive. Jump-to-draft button excluded from open. | **Shipped.** Document router in `inspectClickRouter.ts` opens the inspector. |
| `src/components/ResponseInspectorModal.svelte` | — | Modal container. Synthesises a `Submission`-shaped object from `StudentResponse` + `watchRootLabel`, mounts `<DocPreview>` plus a metrics column. Esc / X / backdrop close. |
| `src/lib/inspectorOpen.svelte.ts` | — | `openInspector` / `closeInspector` — imperative `mount()` on `document.body`. |
| `src/lib/monitorContext.svelte.ts` | — | `syncMonitorGrid()` — grid rows + class label for the inspector, updated synchronously when `AssignmentMonitor` loads/patches. |
| `src/views/AssignmentMonitor.svelte` | `selectedSubmissionId` for right rail. SSE patches into `responses`. | `commitResponses()` calls `syncMonitorGrid`. Listens for `panopticon-inspect` to set rail selection when Inspect opens. Closes inspector when row vanishes or filters change. |
| `src/lib/api.ts` `Submission` interface | 13 fields including `relative_path` and `absolute_path`. | **No change.** `DocPreview` only reads `id`, `student`, `kind`, `assignment`, `filename`, `watch_root_label`, `last_modified_at`. The modal synthesises a `Pick<Submission, …>`-shaped object containing those fields plus stubs (`""`) for `relative_path` / `absolute_path` to satisfy the typed `submission` prop. |
| Roster placeholders (`excerpt_status === "not_submitted"`, `submission_id === ""`) | Card already early-returns on click. | **No change.** Modal never opens for these. |
| `submission-deleted` SSE event for the inspected row | Removes the row from `responses`. | Falls out automatically: deriving `inspectorResponse` from `responses` + `inspectorSubmissionId` means the modal auto-closes when its row vanishes. No special handler needed. |

### Modal shape (decided in the previous session)

```
┌──────────────────────────────────────────────────────────────────┐
│  ●  Emma Wilson    DRAFT                                    [×]  │   header
│     Essay.docx · 7 Digital Tech / Week 3 homework                │
├──────────────────────────────────────────┬───────────────────────┤
│                                          │  Words written  847   │
│   <mammoth HTML, scrollable>             │  Time since edit 12s  │
│                                          │  File size       24 KB│
│   (the full DocPreview, including its    │  Kind           DRAFT │
│    own internal "Open in Word /          │  First seen   9:14 AM │
│    Refresh" buttons, heading scroll,     │  Status          new  │
│    empty-state messaging, etc.)          │                       │
│                                          │  ── Coming soon ──    │
│                                          │  (placeholder rows)   │
│                                          │                       │
└──────────────────────────────────────────┴───────────────────────┘
```

- Backdrop: full-viewport `rgba(0,0,0,0.55)`.
- Modal: `max-width: min(1100px, 95vw)`, `max-height: 90vh`, centered. The grid below remains mounted (CSS `position: fixed; inset: 0`).
- Two-column body via CSS grid: preview takes `1fr`, metrics takes `minmax(220px, 280px)`. Single column under `max-width: 800px` (metrics stack above preview).
- Close affordances: top-right `[×]` button, Esc keydown, click on backdrop (but not on the modal body).

### Behaviour

- **Open.** Click any non-placeholder student card. `inspectClickRouter.ts` calls `openInspector(id)`; rail selection updates via `panopticon-inspect` event.
- **Close.** Esc / X / backdrop → `closeInspector()` unmounts the modal. Right-rail `selectedSubmissionId` is preserved.
- **Auto-close.** `AssignmentMonitor` calls `closeInspector()` when the open row leaves `responses` (class/assignment change, delete, kind filter).
- **Live updates while open.** Grid rows update via SSE; the mounted modal keeps props from open time. Close and re-open Inspect to refresh preview/metrics after a save. _(Future: remount or reactive props on row patch.)_
- **Body scroll.** Set `document.body.style.overflow = "hidden"` while the modal is open; restore on close. Use a `$effect` returning the cleanup.
- **Focus.** Move focus to the close button on open; restore focus to the previously focused element on close. (Cheap focus management — no full focus trap; the modal is read-only and pressing Tab inside is fine.)
- **Accessibility.** `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing at the student name in the header.

### Step-by-step plan

Each step compiles and runs on its own. Run `npm run typecheck` after each before moving on.

1. **Add `ResponseInspectorModal.svelte`.** ✅ DONE (2026-05-27) — `src/components/ResponseInspectorModal.svelte` lands as a standalone presentational component:
   - Props: `response: StudentResponse | null`, `watchRootLabel: string`, `onClose: () => void`.
   - Renders nothing when `response === null` (top-level `{#if response && submission}`).
   - Synthesises a `Submission`-shape object via `$derived` from `response` + `watchRootLabel`; passes to `<DocPreview>`. `relative_path` / `absolute_path` are stubbed with empty strings — `DocPreview` reads only `id`, `student`, `kind`, `assignment`, `filename`, `watch_root_label`, `last_modified_at`.
   - Metrics column uses `<MetricRow>` directly (Phase 1: Words written, Time since edit, File size, Kind, First seen, Status; plus the same four Phase 3 placeholders the rail shows). Skips the `MetricsPanel` outer chrome to avoid duplicating the student name / kind badge / "Open in Word" already rendered by `DocPreview`'s header.
   - Esc handled via `window.addEventListener("keydown", …)` inside a single `$effect` that also locks body scroll, focuses the close button (`queueMicrotask` to land after mount), and restores both on cleanup.
   - Backdrop click filters via `e.target === e.currentTarget` so only the scrim itself closes — clicks inside the dialog body don't bubble through.
   - **Deviation:** added a small `:global(.preview-html)` override inside the modal's `<style>` to cap the embedded preview at `calc(90vh - 14rem)`. The default in `app.css` is `calc(100vh - 12rem)`, sized for Browse mode's full-viewport layout; in the modal that lets the HTML overflow past the close button. Scoped override avoids touching the global token.
2. **Wire open/close path.** ✅ DONE (2026-05-27)
   - `src/lib/inspectorOpen.svelte.ts` — imperative `mount(ResponseInspectorModal)` on `document.body`.
   - `src/lib/monitorContext.svelte.ts` — `syncMonitorGrid()` called from `commitResponses()` in `AssignmentMonitor`.
   - `src/lib/inspectClickRouter.ts` — document listener on `.card` clicks (not roster placeholders; not jump-to-draft).
   - **Deviation:** original plan used `{#if}` in `AssignmentMonitor`; imperative `mount()` on `document.body` is the shipped approach.
3. **Manual verification.** ✅ DONE (2026-05-27) — user confirmed modal opens from grid cards in browser.
4. **Typecheck + tests.** ✅ DONE (2026-05-27) — `npm run typecheck`, `npm test` (51/51), and `npm run build` (1.83 s, 77.35 kB JS / 16.25 kB CSS) all green after the wire-up. No new pure helpers fell out; the `Submission`-shape synthesis is a 13-field literal inside a `$derived`, not worth extracting + testing in isolation.
5. **Doc updates.** ✅ DONE (2026-05-27, this edit). No invalidation of §4's gap-analysis table (the modal is new surface, not a contradiction of prior steps). §6 unchanged — the modal doesn't address the open heading-scroll-in-cards limitation from Step 9.

### Verification recipe

Run `npm run dev`, switch to Live Monitor, pick a class + assignment with at least one student card showing. Then:

1. Click a student card whose `.docx` has content. **Expected:** centered modal over a dimmed backdrop; full preview + metrics column.
2. Press Esc. **Expected:** modal closes; right rail still shows that student (selection set when the card opened the inspector).
3. Click the same card again. **Expected:** modal reopens.
4. Open the modal, then click the dimmed backdrop outside the dialog. **Expected:** modal closes. Click inside the dialog body — nothing happens.
5. Open the modal, click the `[×]` button. **Expected:** modal closes.
6. With the modal open, change `Class` or `Assignment` in the selection bar. **Expected:** modal disappears automatically (the inspected row is no longer in `responses`).
7. With the modal open, edit the `.docx` in Word and save. **Expected:** grid row updates via SSE; close and click the card again to refresh modal content.
8. With the modal open, delete the `.docx` from disk. **Expected:** within ~3 s the modal closes (`closeInspector` when row removed).
9. Roster placeholder (`NO SUBMISSION`). **Expected:** card not clickable; no modal.
10. Open the modal and Tab around. **Expected:** focus starts on the close button; subsequent Tabs move through the close button → preview action buttons → metrics. There's no full focus trap, but it's read-only content so this is fine.

### Definition of done

- [x] `ResponseInspectorModal.svelte` — modal with `<DocPreview>` + metrics column (2026-05-27).
- [x] Esc / X / backdrop close; body scroll locked while open.
- [x] Card click opens modal for non-placeholder cards; roster placeholders not clickable.
- [x] Modal closes when inspected row leaves `responses` (class, assignment, delete, filter).
- [x] `npm run typecheck` and `npm test` green.
- [x] No new top-level dependencies, endpoints, or schema change.
- [x] This section updated with shipped deviations (imperative mount).

---

## 5. Open product decisions

Resolved with defaults on 2026-05-26 (override anytime — these are easy to flip).

1. **Multiple files per student per assignment** — pick latest `.docx`, fall back to latest of any extension. No per-card file picker yet. _Defer the picker until a teacher actually hits a multi-file case._
2. **Default selection** — no student selected; right panel shows the class snapshot. Clicking a card selects; clicking again deselects.
3. **Browse mode** — keep both tabs indefinitely. Browse is still the only way to use full filters + the docx preview pane.
4. **Default `kind` filter** — `working` (live drafts). The dropdown includes `submitted`, `working`, `both`.

---

## 5.5 Follow-up tests

### `pickLatestPerStudent` unit coverage (2026-05-26)

`pickLatestPerStudent` (Step 3, in `server/src/routes.ts`) is a pure rollup helper but had zero unit tests — every regression so far has had to be caught by spotting wrong cards in the browser. Add Vitest coverage so the contract is locked down.

**Extraction decision.** Keep the helper inside `server/src/routes.ts` and just `export` it. Rationale: it's ~15 lines, has a single consumer in this file, and a dedicated `rollup.ts` for one function adds a new module without removing complexity. Importing `routes.ts` from a co-located `routes.test.ts` is fine — top-level side effects in `routes.ts` and its transitive imports (`db.ts`, `config.ts`, `roster.ts`) are pure module loads; nothing opens the DB or reads config until classes are instantiated. If a second rollup helper appears later, that's the right moment to split into `rollup.ts`.

**Test file.** `server/src/routes.test.ts` — matching the `parser.test.ts` / `structure.test.ts` / `metrics.test.ts` style: file-header comment explaining the module and why these tests exist, `describe` per behaviour group, minimal inline `Submission` fixtures, `it.each` where it reads cleanly.

**Cases covered.**

1. One student with one `.docx` → that row chosen.
2. One student with multiple `.docx` ordered DESC by `last_modified_at` (matching `SubmissionStore.list`) → the first `.docx` in input order wins.
3. One student with `.docx` + a newer `.pdf` → `.docx` still wins (extension preference beats recency).
4. One student with only `.pdf` rows → latest `.pdf` chosen.
5. Multiple students mixed in one input → exactly one row per student in output.
6. Empty input → empty output.

Plus a small extra case for the input-order contract (`.docx` ordering with reversed input) to make the "respects DESC ordering" invariant explicit.

**Constraints.** Don't refactor the helper's behaviour — only `export` it. No new dependencies. Don't touch unrelated parts of `routes.ts`.

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
- [x] Phase 2 (roster + empty-state messaging + draft-elsewhere pointer) shipped. See §4.5.
- [x] Response inspector modal (§4.7): card click opens full `DocPreview` + metrics overlay.

---

## Changelog

- **2026-05-27** — §4.7 response inspector shipped: `ResponseInspectorModal`, imperative `mount()` via `inspectorOpen.svelte.ts`, `syncMonitorGrid` + document card-click router. Dev ergonomics: sequenced `scripts/dev.mjs` for `npm run dev`, worktree-safe `vite.config.ts` (`strictPort`, absolute `projectRoot`). UI overlays guidance added to `docs/new-agent.md` and `docs/conventions.md`.
