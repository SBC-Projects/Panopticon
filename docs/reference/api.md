# API Reference

All endpoints live under `/api`. Fields are `snake_case` end-to-end. The server binds to `127.0.0.1` only.

Source of truth: [`server/src/routes.ts`](../../server/src/routes.ts). Update **both** the route and this doc when you change a shape.

---

## Health & meta

### `GET /api/health`

```json
{ "ok": true }
```

### `GET /api/config`

Public-safe view of the loaded watch roots.

```json
{
  "watch_roots": [
    { "label": "9 Digital Tech 1A", "path": "C:/.../Submitted files", "kind": "submitted" }
  ]
}
```

### `GET /api/summary`

Aggregated counts for the header + class cards.

```json
{
  "total": 412,
  "new_count": 8,
  "by_class": [
    {
      "label": "9 Digital Tech 1A",
      "total": 134,
      "new_count": 3,
      "submitted_count": 92,
      "working_count": 42
    }
  ],
  "assignments": [
    { "assignment": "Week 3 homework", "watch_root_label": "9 Digital Tech 1A", "count": 24 }
  ]
}
```

---

## Submissions

### `GET /api/submissions`

Flat list of every indexed file. Query params (all optional, all `AND`-ed):

| Param | Type | Notes |
|-------|------|-------|
| `status` | `"new" \| "seen"` | |
| `assignment` | string | Exact match. |
| `class` | string | Maps to `watch_root_label` server-side. |
| `student` | string | `LIKE %student%`. |
| `kind` | `"submitted" \| "working"` | |

Response: `Submission[]`, ordered by `last_modified_at DESC`. See [`data-model.md`](./data-model.md) for the `Submission` shape.

### `GET /api/submissions/:id`

Single row. `404` if not found.

### `POST /api/submissions/mark-seen`

Clears the NEW flag on every `status = 'new'` row.

```json
{ "marked": 8 }
```

### `POST /api/submissions/:id/mark-seen`

Clears NEW on one row.

```json
{ "ok": true }
```

### `GET /api/submissions/:id/structure`

`.docx` heading outline. Cached by `(id, last_modified_at)` so a second call after no edits is free.

```json
{
  "headings": [
    { "id": "question-1", "level": 1, "text": "Question 1" },
    { "id": "subpart-a", "level": 2, "text": "Subpart A" }
  ]
}
```

`id` matches the `data-heading-id` attribute that `/api/preview/:id` injects.

---

## Assignments (rollup)

### `GET /api/assignments/:label/:assignment/responses`

One row per student for `(watch_root_label, assignment)`. Picks the latest `.docx`, falling back to the latest file of any extension.

URL parameters are `encodeURIComponent`-encoded. Query params:

| Param | Type | Notes |
|-------|------|-------|
| `kind` | `"submitted" \| "working"` | Optional. Omit for both. |

Response: `StudentResponse[]`, sorted by `student.localeCompare`.

```json
[
  {
    "student": "Emma Wilson",
    "submission_id": "abc123...",
    "filename": "Essay.docx",
    "kind": "working",
    "assignment": "Week 3 homework",
    "extension": ".docx",
    "size_bytes": 24576,
    "first_seen_at": "2026-05-25T09:14:00.000Z",
    "last_modified_at": "2026-05-25T12:38:48.000Z",
    "word_count": 847,
    "excerpt": "In this essay I will argue that …",
    "excerpt_status": "ok",
    "status": "new",
    "draft_elsewhere": null
  }
]
```

`word_count` is `null` for non-`.docx` files. `excerpt` is plain text, ~220 chars. Both come from the cached `getDocStats(...)` and are recomputed only when `last_modified_at` or file size changes.

#### `excerpt_status` — why a card may be blank

Every row carries one of these (defined in `server/src/metrics.ts`):

| Status | Meaning |
|--------|---------|
| `ok` | Text extracted successfully. |
| `empty_body` | Docx parsed cleanly but contained no text runs. Often a SharePoint coauthor doc whose latest text isn't on local disk yet. |
| `not_downloaded` | File is 0 bytes on disk (OneDrive Files-On-Demand placeholder hasn't streamed content). |
| `missing` | The absolute path is gone (file deleted/moved). |
| `unsupported_ext` | Not a `.docx`; we don't try to count words. |
| `parse_error` | `mammoth` threw; the server logged details. |
| `not_submitted` | Synthetic — this row is a **roster placeholder** for an enrolled student who has no file at all for this `(assignment, kind)`. See below. |

#### Roster placeholders

After picking the latest row per student, the response is padded with one row per **enrolled student** (union of immediate subfolder names across every watch root sharing the class label) who didn't show up. These rows have:

- `excerpt_status: "not_submitted"`
- `submission_id: ""` (empty string — clients must treat empty as "no real submission")
- `filename: ""`, `extension: ""`, `size_bytes: 0`, `word_count: null`, `excerpt: ""`
- `first_seen_at: ""`, `last_modified_at: ""`
- `status: "seen"`
- `kind` = the requested `?kind=` or `"submitted"` if `?kind=` is omitted
- `assignment` = the requested assignment

#### `draft_elsewhere` — pointer to the opposite kind

When a row's own content is empty (`empty_body`, `not_downloaded`, `missing`, or a roster placeholder) AND `?kind=` is set, the server checks the OPPOSITE kind for that student. If a submission exists there, it's surfaced:

```json
{
  "draft_elsewhere": {
    "submission_id": "def456...",
    "kind": "working",
    "assignment": "Week 3 homework",
    "filename": "Essay-draft.docx",
    "word_count": 412,
    "excerpt": "Started with the introduction …",
    "last_modified_at": "2026-05-26T01:02:03.000Z"
  }
}
```

`null` if the student has nothing in the opposite kind, **or** when `?kind=` was omitted (there is no opposite to point at). The match heuristic prefers the same root assignment family (first ` / `-separated segment); falls back to the student's most-recently-modified submission of any assignment. See `findDraftElsewhere` in [`server/src/roster.ts`](../../server/src/roster.ts).

---

## Preview & file access

### `GET /api/preview/:id`

Renders a single submission for the preview pane.

```json
// .docx
{ "type": "html", "html": "<h1 data-heading-id=\"q1\">…</h1>", "last_modified_at": "…" }

// PDF / image / other binary
{ "type": "binary", "mime": "application/pdf", "last_modified_at": "…" }

// .docx with no extractable text (mirrors excerpt_status above)
{ "type": "empty", "reason": "not_downloaded", "message": "OneDrive hasn't downloaded this file yet …", "last_modified_at": "…" }
{ "type": "empty", "reason": "empty_body",     "message": "This document doesn't contain any text yet. …", "last_modified_at": "…" }

// Unsupported extension
{ "type": "unsupported", "message": "…", "last_modified_at": "…" }

// Parse/IO error
{ "type": "error", "message": "…", "last_modified_at": "…" }
```

`.docx` HTML is post-processed by `injectHeadingIds` so headings carry `data-heading-id` matching the structure endpoint. The `empty` variant exists so the client can render a helpful "what to do" panel (with a "Re-check file" button) instead of the generic error path.

### `GET /api/file/:id`

Streams the raw file with an `inline; filename="…"` Content-Disposition. Used by binary preview embeds.

### `POST /api/open/:id`

Opens the file in its OS-default app (e.g. Word for `.docx`). Uses the `open` npm package.

```json
{ "ok": true }
```

---

## Scan

### `POST /api/scan`

Triggers a full re-walk of every configured watch root. Same code path as `npm run scan`.

```json
{ "scanned": 412, "added": 3 }
```

`added` counts new-content rows (insert or content-change with `status` flipping back to `new`).

---

## SSE

### `GET /api/events`

`text/event-stream`. The server emits one event per `EventBus.emit(...)` and sends a `: keepalive\n\n` comment every 25 s so proxies don't time out.

Client wrapper: `subscribeToEvents` in [`src/lib/api.ts`](../../src/lib/api.ts). It auto-reconnects every 2 s on disconnect.

Current event union:

```ts
type AppEvent = {
  type: "submission-changed";
  id: string;
  kind: "submitted" | "working";
  student: string;
  assignment: string;
  filename: string;
  watch_root_label: string;
  last_modified_at: string;
};
```

When adding a new event type:

1. Extend the union in [`server/src/events.ts`](../../server/src/events.ts).
2. Mirror it in [`src/lib/api.ts`](../../src/lib/api.ts).
3. Add an entry here.

---

## Conventions

- All responses are JSON unless explicitly noted (`/api/file/:id`, `/api/events`).
- Errors use HTTP status codes (`404` for missing rows, `500` for server failures) with `{ "error": "..." }` bodies.
- Path parameters that may contain spaces or `/` must be `encodeURIComponent`-encoded on the client. The server `decodeURIComponent`-decodes them.
- New endpoints go under `/api/` and stay `snake_case` end-to-end. No versioning prefix until we have an external consumer.
