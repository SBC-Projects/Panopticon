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
