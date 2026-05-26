# Data Model

Source of truth: [`server/src/db.ts`](../../server/src/db.ts) (schema) and [`server/src/types.ts`](../../server/src/types.ts) (TypeScript types). Update **all three** (schema, types, this doc) when you change a field.

The whole app runs on one SQLite table. There is intentionally no `classes`, `students`, or `assignments` table — those are derived from the watch-root label and the filesystem path.

---

## `submissions` table

```sql
CREATE TABLE submissions (
  id                  TEXT PRIMARY KEY,
  watch_root          TEXT NOT NULL,
  watch_root_label    TEXT NOT NULL,
  kind                TEXT NOT NULL DEFAULT 'submitted',  -- 'submitted' | 'working'
  student             TEXT NOT NULL,
  assignment          TEXT NOT NULL,
  filename            TEXT NOT NULL,
  relative_path       TEXT NOT NULL,
  absolute_path       TEXT NOT NULL,
  extension           TEXT NOT NULL,
  size_bytes          INTEGER NOT NULL,
  first_seen_at       TEXT NOT NULL,                       -- ISO 8601 UTC
  last_modified_at    TEXT NOT NULL,                       -- ISO 8601 UTC
  status              TEXT NOT NULL DEFAULT 'new'          -- 'new' | 'seen'
);

CREATE INDEX idx_submissions_status     ON submissions(status);
CREATE INDEX idx_submissions_assignment ON submissions(assignment);
CREATE INDEX idx_submissions_kind       ON submissions(kind);
```

### Field meanings

| Column | What it is |
|--------|------------|
| `id` | First 32 hex chars of `sha256(watch_root + '::' + relative_path)`. Stable across runs. |
| `watch_root` | Absolute disk path of the watched folder (e.g. `…/Submitted files`). |
| `watch_root_label` | The "class" name (folder name with ` - Student Work` stripped, or as configured). |
| `kind` | `submitted` (turned in) or `working` (live draft). |
| `student` | First path segment under the watch root. |
| `assignment` | Path segments between student and filename, joined by ` / `. Falls back to `"General"` if the file sits directly in the student folder. |
| `filename` | Last path segment, including extension. |
| `relative_path` | Posix-style relative path from `watch_root` to the file. |
| `absolute_path` | Current location on disk. May change if the user moves their OneDrive folder. |
| `extension` | Lowercased, including the dot (`.docx`, `.pdf`, …). |
| `size_bytes` | Last observed file size. |
| `first_seen_at` | When Panopticon first inserted the row. ISO 8601 UTC. |
| `last_modified_at` | File `mtime` at last upsert. ISO 8601 UTC. |
| `status` | `new` until the user clicks "Mark all seen". Flips back to `new` on any content change. |

### Invariants

1. `id` is deterministic from `(watch_root, relative_path)`. Two rows with the same `id` are the same file.
2. `kind` is fixed per watch root (every Submitted-files watch root produces `kind='submitted'`; every Working-files watch root produces `kind='working'`).
3. `status = 'new'` ⇔ the row was inserted or its `last_modified_at` changed since the last "mark seen".
4. The same `(student, assignment, watch_root_label)` tuple **can** have multiple rows — students often save multiple files, and may have both a working and a submitted version.
5. **The watcher deletes a row when chokidar fires `unlink`** for that file. The deletion is permanent — if the file reappears the next `add` event will re-insert it with a fresh `first_seen_at`. (Polling fallback only inserts/updates; it never deletes, because it can't tell "file gone forever" from "file temporarily out of sync".)

---

## Store surface (`SubmissionStore`)

Public methods exposed by `server/src/db.ts`. Keep this table in sync when you add or rename one.

| Method | Returns | Used by |
|--------|---------|---------|
| `upsertFromFile(watchRoot, label, kind, absolutePath, parsed, mtime, size)` | `{ isNew: boolean }` — `isNew` is true on insert OR on content change of a previously-seen row | `watcher.ts` (add/change), `scanner.ts` (boot scan) |
| `list(filters?)` | `Submission[]` ordered `last_modified_at DESC`; filters AND-ed | `routes.ts` (submissions + responses endpoints), `roster.ts` |
| `getById(id)` | `Submission \| undefined` | `routes.ts`, `preview.ts` |
| `deleteById(id)` | `Submission \| undefined` — returns the deleted snapshot (so the caller can build an event payload before the row is gone), or `undefined` when no row matched | `watcher.ts` (chokidar `unlink` handler) |
| `markAllSeen()` | `number` of rows flipped from `new` to `seen` | `routes.ts` `POST /api/submissions/mark-seen` |
| `markSeen(id)` | `void` | `routes.ts` `POST /api/submissions/:id/mark-seen` |
| `getSummary()` | `Summary` — see [`api.md`](./api.md#get-apisummary) | `routes.ts` `GET /api/summary` |
| `close()` | `void` | `index.ts` shutdown |

---

## TypeScript types

Direct mirror of the table.

```ts
// server/src/types.ts

export type SubmissionKind = "submitted" | "working";

export interface WatchRoot {
  path: string;
  label: string;
  kind: SubmissionKind;
}

export interface AppConfig {
  watch_roots: WatchRoot[];
  ignore_globs: string[];
  poll_fallback_seconds: number;
  server: { host: string; port: number };
  student_work_root?: string;
}

export interface Submission {
  id: string;
  watch_root_label: string;
  kind: SubmissionKind;
  student: string;
  assignment: string;
  filename: string;
  relative_path: string;
  absolute_path: string;
  extension: string;
  size_bytes: number;
  first_seen_at: string;
  last_modified_at: string;
  status: "new" | "seen";
}

export interface ParsedPath {
  student: string;
  assignment: string;
  filename: string;
  relative_path: string;
}
```

The client mirrors `Submission` in [`src/lib/api.ts`](../../src/lib/api.ts). When you change the server type, change the client one in the same commit.

---

## Derived shapes (not stored)

These are computed at request time, not columns.

### `Summary` (`GET /api/summary`)

Aggregated counts. Source: `SubmissionStore.getSummary()`.

### `StudentResponse` (`GET /api/assignments/:label/:assignment/responses`)

One latest-per-student row plus `word_count`, `excerpt`, and `excerpt_status` from `getDocStats(...)`, an `assignment` mirror of the parent submission, and an optional `draft_elsewhere` pointer. Roster placeholders (enrolled students with no file at all) are merged in as rows with `excerpt_status: "not_submitted"` and an empty `submission_id`. See [`api.md`](./api.md#get-apiassignmentslabelassignmentresponses) for the wire shape.

### `ExcerptStatus` enum

Defined in [`server/src/metrics.ts`](../../server/src/metrics.ts) and mirrored on the client in [`src/lib/api.ts`](../../src/lib/api.ts). One of:

`"ok" | "empty_body" | "not_downloaded" | "missing" | "unsupported_ext" | "parse_error" | "not_submitted"`

Drives card empty-state copy and the dashed-border roster placeholder treatment in `StudentResponseCard.svelte`. See [`api.md`](./api.md) for what each code means.

### `DraftElsewhere`

```ts
export interface DraftElsewhere {
  submission_id: string;
  kind: SubmissionKind;        // always the OPPOSITE of the row carrying it
  assignment: string;
  filename: string;
  word_count: number | null;
  excerpt: string;
  last_modified_at: string;
}
```

Computed by `findDraftElsewhere(store, classLabel, student, currentKind, currentAssignment)` in [`server/src/roster.ts`](../../server/src/roster.ts). Only attached to a `StudentResponse` when (a) the row's own content is empty (or a placeholder) and (b) the request specified a `?kind=`. Lets the card render a one-click jump to the student's actual draft (or turned-in copy).

### Class roster

`getClassRoster(config, classLabel, kind?)` in [`server/src/roster.ts`](../../server/src/roster.ts) returns the **union of immediate-subfolder names** across every watch root that shares the class label. There is no `students` table; the roster is derived from the filesystem at request time. Used by the responses endpoint to surface enrolled students who have no file yet.

### `Heading` (`GET /api/submissions/:id/structure`)

`{ id, level, text }` extracted from `.docx` headings via `mammoth` + `parseHeadings` (`server/src/structure.ts`).

---

## Migrations

We don't have a migration system. The pattern in `SubmissionStore.init()` is:

```ts
const cols = this.db.prepare("PRAGMA table_info(submissions)").all() as { name: string }[];
if (!cols.some((c) => c.name === "kind")) {
  this.db.exec("ALTER TABLE submissions ADD COLUMN kind TEXT NOT NULL DEFAULT 'submitted'");
}
```

For any **new column**:

1. Add it to the `CREATE TABLE` statement (for fresh installs).
2. Add a `PRAGMA table_info` check and `ALTER TABLE ADD COLUMN` (for existing DBs).
3. Default value must be non-null so existing rows stay valid.

For any **column rename** or non-additive change: drop and rebuild. We're not yet at the scale where preserving a teacher's local DB across schema rewrites is worth a migration framework. If we ever ship outside one machine, revisit.

---

## Caches that look like data

These live in memory, not the DB. Don't mistake them for state:

| Cache | Where | Key | Invalidated when |
|-------|-------|-----|------------------|
| Doc stats (`word_count`, `excerpt`, `excerpt_status`) | `server/src/metrics.ts` `getDocStats` | `submission_id` | `last_modified_at` **or** file size changes (size catches OneDrive 0-byte → real-bytes transitions) |
| Structure (headings) | `server/src/structure.ts` `getStructure` | `(submission_id, last_modified_at)` | Process restart or mtime change |

Process restart wipes both. That's fine; first request after restart pays the recompute.
