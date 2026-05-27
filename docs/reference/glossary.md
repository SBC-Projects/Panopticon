# Glossary

The terms below have **specific, narrow meanings** in Panopticon. If you're writing code or docs, use them this way.

---

### Class

A grouping of students that corresponds to **one watch-root label**. There is no `classes` table — the class is just the `watch_root_label` string carried on every submission.

> "Filter the dashboard by class" = filter by `watch_root_label`.

### Watch root

A folder on disk that Panopticon monitors. In practice it's always either `… - Student Work/Submitted files` or `… - Student Work/Working files`. Each watch root has:

- A `path` (absolute, on disk).
- A `label` (the class name, with ` - Student Work` stripped).
- A `kind` (`submitted` or `working`, usually inferred from the parent folder name).

Configured in `config.yaml` under `watch_roots:`, or auto-discovered from `student_work_root`.

### Student

The **first path segment** under a watch root. Panopticon doesn't have a roster; if SharePoint names the student "Emma Wilson", that's the student name forever.

### Assignment

Derived from the **path segments between the student folder and the file**, joined by ` / `. Examples:

| File path under the watch root | Assignment |
|-------------------------------|------------|
| `Emma Wilson/Week 3/essay.docx` | `Week 3` |
| `Emma Wilson/Week 3/Drafts/v2.docx` | `Week 3 / Drafts` |
| `Emma Wilson/essay.docx` | `General` (fallback) |

An assignment is identified by the tuple `(watch_root_label, assignment)`. There is no `assignments` table.

### Kind

The string `"submitted"` or `"working"`. Every submission has exactly one.

- **`submitted`** = the student clicked "Turn In". File lives under `Submitted files/`. Badge: TURNED IN.
- **`working`** = a live draft the student is still editing. File lives under `Working files/`. Badge: DRAFT.

A single student can have rows of both kinds for the same `(class, assignment)`.

### Submission

A row in the `submissions` table. One file on disk = one submission. See [`data-model.md`](./data-model.md).

The same student can have **multiple submissions** for the same assignment — e.g. they uploaded three files, or they have both a working and a submitted version. The Live Monitor view collapses these to one card by picking the latest `.docx` (or latest of any extension as a fallback).

### Submission ID

`sha256(watch_root + "::" + relative_path).slice(0, 32)`. Stable across process restarts. Same file → same ID.

### `last_modified_at`

The file's `mtime` at the last upsert, as ISO 8601 UTC. This is what drives activity-state colours in the Live Monitor (`< 60s` = live, `< 5 min` = recent, else idle).

### `first_seen_at`

The time **Panopticon** first inserted the row, not the time the file was originally created. So if you delete `data/panopticon.db` and rescan, `first_seen_at` resets.

### Status (`new` / `seen`)

UI state for the NEW badge. Inserted rows start `new`. "Mark all seen" sets them to `seen`. If the file changes content afterwards, it flips back to `new`.

### Browse mode

The original Panopticon view: a sidebar of every file + a single-doc preview pane. Good for catching up.

### Live Monitor mode

The newer assignment-centric view: pick a class + assignment, see one card per student. Good for watching a class write in real time.

### SSE channel / live channel

`GET /api/events`, an `EventSource` stream. The `EventBus` on the server emits events; every connected client receives them. This is the live-update path.

### Polling fallback

The 30-second timer in `App.svelte` (configurable via `poll_fallback_seconds`). Only fires if SSE drops. Not the primary update mechanism.

### Activity state

A derived label for "how recently did this file change":

| State | Threshold |
|-------|-----------|
| `live` | < 60 s since `last_modified_at` |
| `recent` | < 5 min |
| `idle` | ≥ 5 min |
| `missing` | No file at all for this student |

Defined in `src/lib/metrics.svelte.ts`.

### Roster

The set of students "in" a class. Panopticon doesn't have a roster table — the roster is the **union of immediate-subfolder names across every watch root sharing the class label**. So a student is "enrolled" the moment SharePoint creates their student folder, even before they've turned anything in. Derived by `getClassRoster` in `server/src/roster.ts`.

### Roster placeholder

A `StudentResponse` row synthesised by the responses endpoint for an enrolled student who has **no file** for the requested `(assignment, kind)`. Has `excerpt_status: "not_submitted"`, an empty `submission_id`, and zero-value file fields. The grid renders these with a dashed border and "NO SUBMISSION" badge so the teacher can see "Bear hasn't started" without flipping filters.

### Draft elsewhere

When a student's row in the current view is empty (or a roster placeholder), the server may attach a `draft_elsewhere` pointer to the same student's submission in the **opposite kind** — typically a live Working draft when the Submitted file is a 0-byte placeholder. Powers the "View draft →" jump button on cards. See `findDraftElsewhere` in `server/src/roster.ts`.

### Excerpt status

The reason a card's excerpt is or isn't populated. One of `ok`, `empty_body`, `not_downloaded`, `missing`, `unsupported_ext`, `parse_error`, `not_submitted`. Drives card empty-state copy and the placeholder treatment. See [`api.md`](./api.md#excerpt_status--why-a-card-may-be-blank) for the full table.

### Slide title

For a `.pptx` submission, the text inside the slide's **title placeholder** (`<p:ph type="title">` or `type="ctrTitle">` in the slide XML). Distinct from a docx **heading**: docx headings come from the author applying a Heading style to a paragraph, whereas slide titles come from a layout-bound placeholder shape — almost every deck has them, almost no student docx does. Slides without a title placeholder fall back to `Slide <N>` so the Question dropdown never has blank entries. Extracted by `extractPptxSlideTitles` in [`server/src/pptx.ts`](../../server/src/pptx.ts) and surfaced as `Heading` entries with `level: 1` and `id: "slide-<N>"`.

### Scratch

Folder for one-off scripts, fixtures, and notes. Gitignored. See [`workflows/testing.md`](../workflows/testing.md).

### Scan

A one-shot recursive walk of every configured watch root. Triggered on boot, by `POST /api/scan`, or by running `npm run scan`. Distinct from the continuous chokidar watcher.

---

## Words we do NOT use

To avoid drift, don't use these synonyms unless quoting Microsoft docs:

| Avoid | Use instead |
|-------|-------------|
| Cohort, group, section | **Class** |
| Task, homework, exercise | **Assignment** |
| Draft (as a noun in code) | **`kind: "working"`** |
| Turn-in, hand-in (in code/types) | **`kind: "submitted"`** |
| Document, doc, file (interchangeably) | Pick one and be consistent inside a feature doc |
