# Architecture

A teacher-side desktop dashboard for Microsoft Teams assignment submissions. Everything runs on the teacher's machine. Nothing is uploaded.

---

## The big picture

```
┌────────────────────────────────────────────────────────────────────────┐
│  Teacher's PC                                                          │
│                                                                        │
│   OneDrive ── syncs ──▶ "* - Student Work/{Submitted,Working} files/"  │
│        │                                  │                            │
│        │                                  ▼                            │
│        │                       ┌────────────────────┐                  │
│        │                       │ chokidar watcher   │                  │
│        │                       │ (server/watcher.ts)│                  │
│        │                       └─────────┬──────────┘                  │
│        │                                 │  add/change                 │
│        │                                 ▼                             │
│        │                       ┌────────────────────┐  ┌────────────┐  │
│        │                       │ SubmissionStore    │  │ EventBus   │  │
│        │                       │ (SQLite, db.ts)    │  │ (events.ts)│  │
│        │                       └─────────┬──────────┘  └─────┬──────┘  │
│        │                                 │                   │         │
│        │                                 ▼                   ▼         │
│        │                       ┌────────────────────────────────────┐  │
│        │                       │ Express API (routes.ts)            │  │
│        │                       │   /api/summary    /api/preview/:id │  │
│        │                       │   /api/events     /api/assignments │  │
│        │                       │   /api/submissions                 │  │
│        │                       └─────────────────┬──────────────────┘  │
│        │                                         │                     │
│        │                                         ▼                     │
│        │                            Svelte 5 dashboard (src/)          │
│        │                            Browser at :5173 (dev) or :8765    │
└────────────────────────────────────────────────────────────────────────┘
```

**One process** (`tsx server/src/index.ts`) runs the watcher, SQLite, and the HTTP/SSE API. In dev, Vite serves the UI on `:5173` and proxies to `:8765`. In prod, Express also serves the built `dist/`.

---

## Boot sequence

In order, from `server/src/index.ts`:

1. **Load config + open SQLite.** Existing rows from `data/panopticon.db` are immediately queryable.
2. **`app.listen(host, port)`** — HTTP + SSE bind. **Anything past this point runs after the API is reachable**, so a fresh `npm run dev` returns 200 from `/api/health` within ~5 seconds on Windows.
3. **`watcher.start()`** — chokidar starts with `ignoreInitial: true`. Only *future* `add` / `change` / `unlink` events get processed.
4. **Background scan** (via `setImmediate`) — `scanWatchRoots(roots, store, events)` walks every configured root, upserts each file, and **emits `submission-changed` per newly-inserted row** so connected clients populate progressively over SSE.

The scan walks every configured watch root and `fs.statSync`s each file. On Windows + OneDrive Files-On-Demand that adds up — a few hundred files can take 30–90 s on a cold cache, even more if OneDrive is rehydrating placeholders. Deferring the walk behind `listen()` is what makes dev feel snappy; emitting events from it is what keeps the first-run UX correct.

`npm run scan` (one-shot, exits when done) keeps the original synchronous order — `scanResult` is printed before exit, so CI / scripts can still rely on it.

---

## Data flow (a file appears)

1. Student turns in or saves a draft in Teams.
2. SharePoint mirrors it to the teacher's OneDrive folder.
3. OneDrive syncs the file to disk (seconds to minutes).
4. `chokidar` fires `add` / `change` on the synced path.
5. `SubmissionWatcher.scheduleProcess` debounces the event (1.5 s).
6. `parseSubmissionPath` derives `(watch_root_label, student, assignment, filename)` from the relative path.
7. `SubmissionStore.upsertFromFile` writes/updates the row. If new content, `status = 'new'`.
8. `EventBus.emit({ type: "submission-changed", ... })` fans out to every connected SSE client.
9. The frontend's `subscribeToEvents` callback fires and the relevant view patches in place.

A poll fallback (`poll_fallback_seconds`, default 30) walks the watch roots periodically to catch anything chokidar missed.

---

## File map — where things live

### Server (`server/src/`)

| File | Role |
|------|------|
| `index.ts` | App entrypoint. Loads config, mounts router, binds HTTP/SSE, starts watcher, kicks off the background scan. See *Boot sequence* above. |
| `config.ts` | Loads `config.yaml`. Resolves `student_work_root`, auto-discovers `* - Student Work` folders. |
| `types.ts` | Canonical `Submission`, `SubmissionKind`, `WatchRoot`, `AppConfig`. |
| `parser.ts` | `parseSubmissionPath` (relative path → `{student, assignment, filename}`), `submissionId`, `shouldIgnoreFile`. |
| `db.ts` | `SubmissionStore` — SQLite via `node:sqlite`. Schema, list, upsert, summary. |
| `scanner.ts` | One-shot recursive walk of all watch roots. Used by the deferred boot scan, the `npm run scan` one-shot, and `POST /api/scan`. When an `EventBus` is passed, emits `submission-changed` per newly-inserted row so clients populate progressively. |
| `watcher.ts` | `SubmissionWatcher` — chokidar + debounce + poll fallback. Emits `submission-changed` events. |
| `events.ts` | `EventBus` — simple in-process pub/sub for SSE. |
| `routes.ts` | All HTTP/SSE endpoints. See [`reference/api.md`](./reference/api.md). |
| `preview.ts` | Reads a file off disk for `/api/preview/:id`. `.docx` → HTML via `mammoth`, others streamed. Distinguishes `empty` (0-byte / empty body), `unsupported`, and `error` outcomes so the client can render the right "why is this blank" panel. |
| `metrics.ts` | `getDocStats(submission_id, path, ext, mtime)` → `{ word_count, excerpt, excerpt_status }`. Cached by `submission_id`; invalidated on `mtime` **or** size change. Logs `mammoth`/read failures. |
| `structure.ts` | `.docx` heading extraction + `injectHeadingIds` HTML post-processing for in-page scroll. |
| `*.test.ts` | Vitest unit tests co-located with the source they cover. |
| `roster.ts` | `getClassRoster(config, label, kind?)` — union of immediate-subfolder names across the class's watch roots, so the Live Monitor can show enrolled students who haven't submitted. `findDraftElsewhere(...)` — looks up the same student's submission in the OPPOSITE kind to power the "View draft →" jump button. |

### Client (`src/`)

| File | Role |
|------|------|
| `main.ts`, `App.svelte` | Bootstraps the app and hosts the Browse / Live Monitor mode toggle. |
| `app.css` | Design tokens: `--surface`, `--surface2`, `--border`, `--text`, `--muted`, `--accent`, `--new`, `--new-bg`, `--warn`. **Reuse these, don't hardcode colours.** |
| `lib/api.ts` | All fetch wrappers + the SSE subscriber. Anything new on the wire is typed here first. |
| `lib/metrics.svelte.ts` | `now` shared ticker (15 s), `formatRelativeTime`, `activityState`. Named `.svelte.ts` because runes don't work in plain `.ts`. |
| `views/AssignmentMonitor.svelte` | The Live Monitor view (assignment-centric). |
| `components/DocPreview.svelte` | Single-doc HTML/binary preview with stale-guard + silent reload. **Reuse, don't reimplement.** |
| `components/SelectionBar.svelte` | Class / Assignment / Question / Kind / Search controls for the monitor view. |
| `components/StudentResponseGrid.svelte` | Grid of student cards (loading + empty states live here). |
| `components/StudentResponseCard.svelte` | One student tile: name, activity dot, kind badge, word count, excerpt. |
| `components/MetricsPanel.svelte` | Right-side panel: per-student metrics or class summary if none selected. |
| `components/MetricRow.svelte` | Label/value row, with placeholder styling for future metrics. |
| `components/ActivityIndicator.svelte` | Live/recent/idle dot driven by `now` + `last_modified_at`. |

---

## Key invariants

1. **`watch_root_label` is "the class".** There is no `classes` table. A class is just the label on a watch root.
2. **An assignment is derived from the filesystem path**, not stored as a row. Identified by `(watch_root_label, assignment)` tuple.
3. **Every submission has `kind: "submitted" | "working"`.** Working = live draft. Submitted = turned in. The same student can have rows in both for the same assignment.
4. **`snake_case` on the wire and in the DB.** TypeScript interfaces mirror it. No `camelCase` translation layer.
5. **Single process.** API, watcher, and SSE all share memory (the `EventBus` is in-process).
6. **All paths through SQLite.** The watcher writes; routes read. No in-memory mirror of the table.
7. **SSE is the live channel.** Polling exists as a 30 s fallback only.

---

## Decisions already made (don't re-litigate)

| Decision | Rationale |
|----------|-----------|
| Svelte 5 with runes, no React/Vue | Single-page UI, zero framework churn, runes ergonomics. |
| `node:sqlite` (not better-sqlite3) | Built into Node 22+. Zero install pain. |
| `mammoth` for `.docx` → HTML | Good fidelity, no Office install needed. |
| No ORM | One table. Raw SQL is shorter than any ORM config. |
| No auth | App is local-only. Only the teacher's browser can reach `127.0.0.1:8765`. |
| No router | One view + a mode toggle. URLs aren't part of the UX. |
| `data/panopticon.db` in repo root | Single file, easy to delete and re-scan. Gitignored. |
| `config.yaml` gitignored, `config.example.yaml` checked in | Paths are machine-specific. |
| No CSS framework | The token system in `app.css` covers everything we need. Tailwind would be more bytes than logic. |

If you want to overturn any of these, write a one-paragraph proposal first and ask the user.

---

## Performance assumptions

The app is designed for **one teacher, ~5 classes, ~30 students per class, ~10 assignments per class**. That's a few thousand rows at most. Don't optimise for scale beyond this without asking.

- SQLite queries are not indexed beyond `status`, `assignment`, `kind`. Add an index only if a query is measurably slow.
- The assignment rollup endpoint groups in JS (it's <50 rows per call). Don't push it into SQL unless profiling says so.
- `getDocStats` caches by `(submission_id, mtime)` so word counts and excerpts aren't recomputed on every poll.

---

## Privacy & security model

- The HTTP server binds to `127.0.0.1` only. Not reachable from the LAN.
- No outbound network calls in production.
- No telemetry.
- The DB and synced files contain student work — treat them with the same sensitivity as any school filesystem.
