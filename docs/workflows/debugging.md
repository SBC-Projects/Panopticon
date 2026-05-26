# Debugging Workflow

How to run, log, and inspect Panopticon while developing. Pair with [`testing.md`](./testing.md) for verification recipes.

---

## 1. Running locally

### Full stack with hot reload

```powershell
npm run dev
```

Two coloured streams print to one terminal:
- `server` — the Express + watcher process on `:8765`.
- `web` — Vite on `:5173`. This is the URL you open in the browser; it proxies `/api` to `:8765`.

`tsx` runs the server with no build step, so any `.ts` change restarts it. Vite hot-reloads the UI without a refresh in most cases.

### Server only

```powershell
npm run dev:server
```

Useful when you're hitting `/api` with curl/fetch and don't want UI noise.

### One-shot scan

```powershell
npm run scan
```

Walks every watch root, upserts every file into SQLite, exits. Use this to populate the DB without leaving the watcher running.

### Production-like

```powershell
npm run build && npm start
```

Same code as `dev:server`, but Express also serves the built UI from `dist/`. Use this when you're testing the served-by-Express path (CORS, static routing).

---

## 2. Where the state lives

| Thing | Location |
|-------|----------|
| Persisted submissions | `data/panopticon.db` (SQLite, gitignored) |
| Config | `config.yaml` (gitignored) |
| Built UI | `dist/` (gitignored) |
| Watched files | Wherever your `config.yaml` points |

To reset to a known-empty state:

```powershell
# Stop the server first (Ctrl-C)
Remove-Item data\panopticon.db
npm run dev    # will recreate + rescan
```

---

## 3. Inspecting the API

The server is happy to chat over plain HTTP.

```powershell
# Quick health + summary
curl http://127.0.0.1:8765/api/health
curl http://127.0.0.1:8765/api/summary | jq

# All submissions, optionally filtered
curl "http://127.0.0.1:8765/api/submissions?kind=working" | jq

# Assignment rollup (the Live Monitor endpoint)
$cls = [uri]::EscapeDataString("9 Digital Tech 1A")
$asgn = [uri]::EscapeDataString("Week 3 homework")
curl "http://127.0.0.1:8765/api/assignments/$cls/$asgn/responses?kind=working" | jq

# Listen to live events
curl -N http://127.0.0.1:8765/api/events
```

Full endpoint catalogue: [`../reference/api.md`](../reference/api.md).

---

## 4. Inspecting the database

`node:sqlite` is the in-process driver. For a CLI session, install the standalone `sqlite3` tool from [sqlite.org/download](https://sqlite.org/download.html) and:

```powershell
sqlite3 data\panopticon.db
sqlite> .headers on
sqlite> .mode column
sqlite> SELECT student, assignment, kind, status FROM submissions WHERE watch_root_label = '9 Digital Tech 1A' ORDER BY last_modified_at DESC LIMIT 20;
sqlite> .exit
```

Schema lives in [`../reference/data-model.md`](../reference/data-model.md).

---

## 5. Inspecting the client

Standard browser DevTools.

- **Network tab → EventStream**: select the `/api/events` request to see SSE messages flowing in.
- **Console**: `subscribeToEvents` doesn't log by default — drop a temporary `console.log` in `src/lib/api.ts` when you need to see every event.
- **Components**: Svelte 5 doesn't have a debugger panel like Svelte 4's devtools yet. Use `$inspect(varName)` in a component to log every change to that variable.

```svelte
<script>
  let count = $state(0);
  $inspect(count);    // logs to the console on every change
</script>
```

---

## 6. Common failure modes

| Symptom | Likely cause | Where to look |
|---------|--------------|---------------|
| `config.yaml not found` | Forgot the copy step | `server/src/config.ts` |
| `No watch roots found` | `student_work_root` not set, or no `* - Student Work` folders under it | `server/src/config.ts` `discoverWatchRoots` |
| API up, no submissions | Watcher hasn't seen any files yet — try `POST /api/scan` or `npm run scan` | `server/src/scanner.ts` |
| Live dot stays red | SSE disconnect not reconnecting | `subscribeToEvents` in `src/lib/api.ts` |
| Preview shows stale content | Stale-guard hit a bug — check `currentReqId` logic | `src/components/DocPreview.svelte` |
| `mammoth` throws on a file | Corrupt/locked `.docx`. The error bubbles into `/api/preview/:id` as `{ type: "error" }` | `server/src/preview.ts` |
| Duplicate "add" + "change" events per save | OneDrive writes in two stages — that's why the watcher debounces 1.5 s | `server/src/watcher.ts` `scheduleProcess` |

---

## 7. Adding logging

Server side: `console.log` is fine. The dev terminal shows everything. Prefix with `[watcher]`, `[routes]`, etc. so it's grep-able.

```ts
console.log(`[routes] /assignments/${label}/${assignment} → ${responses.length} rows`);
```

Remove debug logs before declaring a task done. Keep informational logs (like the `New <kind>` line in `index.ts`) only if they pull their weight.

Client side: `console.log` for ad-hoc, `$inspect` for reactive values. Don't leave either in committed code.

---

## 8. Reproducing a student's setup

If you're debugging an issue that only happens for a specific student or class, you can create a minimal fixture:

```powershell
mkdir scratch\fixture\"Demo Class - Student Work"\"Submitted files"\"Test Student"\"Test Assignment"
# Drop a .docx in there
```

Then point `student_work_root` at `scratch/fixture/` (in `config.yaml`) and `npm run dev`. The watcher will pick up your fake hierarchy.

`scratch/` is gitignored — keep all fixture work there.
