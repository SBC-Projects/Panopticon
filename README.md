# Panopticon

Monitor student Teams assignment submissions locally — no Microsoft app registration required.

Teams stores turned-in files in SharePoint **Student Work → Submitted files**. Add OneDrive shortcuts to those libraries; Panopticon watches the synced paths and shows new submissions (and live drafts) in a local dashboard with Word preview.

Everything stays on your machine. No cloud, no telemetry.

---

## Quick start

```bash
cp config.example.yaml config.yaml   # edit student_work_root if needed
npm install
npm run dev                          # API on :8765, UI on :5173
```

Production:

```bash
npm run build
npm start                            # serves UI + API on :8765
```

---

## Docs

- **Users (teachers):** [`docs/how-to-use.md`](./docs/how-to-use.md) — install, configure, day-to-day usage, troubleshooting.
- **AI coding agents:** [`docs/README.md`](./docs/README.md) — start here. Routes you to the right design / reference / workflow doc.
  - Starting a feature/fix: [`docs/new-agent.md`](./docs/new-agent.md).
  - Wrapping up (test → clean up → commit → merge → push): [`docs/end-agent.md`](./docs/end-agent.md).
  - Architecture overview: [`docs/architecture.md`](./docs/architecture.md).
  - Hard rules: [`docs/conventions.md`](./docs/conventions.md).

---

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Server + Vite UI, both with hot reload |
| `npm run dev:server` | Server only (port 8765) |
| `npm run scan` | One-shot scan of all watch roots, then exit |
| `npm run build` | Build the UI into `dist/` |
| `npm start` | Run the server, serving the built UI |
| `npm run typecheck` | `tsc --noEmit` over the whole repo |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |

---

## Stack

Svelte 5 (runes) + Vite on the client. Node 22 + Express + `node:sqlite` + chokidar + mammoth on the server. One process, one SQLite file, one HTTP/SSE endpoint surface. See [`docs/architecture.md`](./docs/architecture.md) for the full picture.

---

## Privacy

The HTTP server binds to `127.0.0.1` only. No outbound network calls. The SQLite DB (`data/panopticon.db`) and OneDrive-synced files live entirely on the teacher's PC.
