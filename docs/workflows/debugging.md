# Debugging Workflow

How to run, log, and inspect Panopticon while developing. Pair with [`testing.md`](./testing.md) for verification recipes.

---

## 1. Running locally

### Full stack with hot reload

```powershell
npm run dev
```

This runs [`scripts/dev.mjs`](../../scripts/dev.mjs), a tiny Node orchestrator that **sequences** the two halves rather than launching them in parallel:

1. Starts the server (`npm run dev:server` → `tsx watch server/src/index.ts`).
2. Waits for the server to print `Panopticon API: http://...` — that line fires from inside `app.listen()`'s callback in [`server/src/index.ts`](../../server/src/index.ts), so it's a tight signal for "HTTP + SSE are bound".
3. Only then starts Vite (`npm run dev:web` → `vite`).

Two coloured streams print to one terminal, with each line prefixed by its origin:
- `[server]` (blue) — Express + watcher process on `:8765`.
- `[web]` (green) — Vite on `:5173`. This is the URL you open in the browser; it proxies `/api` to `:8765`.
- `[dev]` (grey) — the orchestrator's own status lines (`starting server…`, `server is up — starting Vite…`).

`tsx` runs the server with no build step, so any `.ts` change restarts it. Vite hot-reloads the UI without a refresh in most cases.

The server binds within ~5 seconds on a freshly-restarted machine, Vite starts immediately after, and the OneDrive scan then runs **in the background** without blocking either. See [`../architecture.md#boot-sequence`](../architecture.md#boot-sequence). The `ECONNREFUSED` spam that the old parallel-launch setup used to produce is gone because Vite doesn't start until the API is reachable.

**Ctrl-C is safe.** On Windows the orchestrator walks the full child process tree with `taskkill /T /F` so `tsx watch` and `vite` don't leave grandchildren around to lock `data/panopticon.db` or hold `:8765` in TIME_WAIT. If you ever do find a stray `node.exe` (e.g. left over from a hard kill in a different worktree), `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'tsx|server/src/index|vite' }` then `Stop-Process -Force` will clear it.

**If you want to run just one half** (e.g. to focus on server logs without Vite noise, or to debug Vite without an active watcher), the underlying scripts are still wired up — see *Server only* below and the `dev:web` script in `package.json`. The orchestrator is a convenience over those, not a wrapper they live inside.

**If the orchestrator times out waiting for the bind line** (it'll print `server didn't print "Panopticon API:" within 60s — starting Vite anyway` and start Vite regardless), the server child is wedged. Check its log lines for `EADDRINUSE` (something else holds `:8765`) or `config.yaml not found`, fix the underlying issue, and re-run.

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
| API up, no submissions | On a fresh DB this is expected for the first ~90 s — the background scan is still walking OneDrive. Rows trickle in over SSE. If it persists, hit `POST /api/scan` or `npm run scan` | `server/src/scanner.ts`, `server/src/index.ts` (boot sequence) |
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
