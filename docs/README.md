# Panopticon — Docs for AI Agents

This folder is the source of truth for AI coding agents working on Panopticon. Read the relevant doc(s) **before** writing code. Keep these docs updated when the implementation changes.

## What Panopticon is (one paragraph)

Panopticon watches OneDrive-synced Microsoft Teams submission folders on the teacher's local machine and shows a live dashboard of student work. Backend: Express + SQLite + chokidar (`server/`). Frontend: Svelte 5 with runes + Vite (`src/`). All data stays local — no Microsoft app registration, no cloud uploads.

## Docs in this folder

| Doc | When to read |
|-----|--------------|
| [`live-monitor-implementation.md`](./live-monitor-implementation.md) | Building the assignment-centric live monitor view (Class → Assignment → wall of student responses + metrics). Includes the agreed UI plan, a gap analysis vs current code, and a step-by-step build order. |

## Hard rules for agents

1. **Stack is fixed.** Svelte 5 (runes: `$state`, `$derived`, `$effect`), TypeScript, Express, `node:sqlite`. Do **not** introduce React, Vue, Tailwind, ORMs, or other frameworks.
2. **Field names mirror the DB** (`snake_case`: `watch_root_label`, `last_modified_at`, `kind`). Don't rename to camelCase on the wire.
3. **`watch_root_label` is the "class".** There is no `classes` table — the class is the watch-root folder label.
4. **An "assignment" is derived from filesystem path**, not a row. It's identified by the tuple `(watch_root_label, assignment)`.
5. **`kind` matters.** Every submission is either `"submitted"` (turned in) or `"working"` (live draft). Live editing happens in `working`.
6. **Live updates use SSE, not polling.** `GET /api/events` already streams change events via `EventBus`. Prefer subscribing to it over adding new poll loops. Polling at 12s is the existing fallback in `App.svelte` — keep it as a fallback only.
7. **Reuse `DocPreview.svelte`.** It already handles stale-request guards, silent reloads, and "updated" pills. Don't reimplement preview loading.
8. **Reuse CSS tokens** from `src/app.css` (`--surface`, `--surface2`, `--border`, `--text`, `--muted`, `--accent`, `--new`, `--new-bg`). Don't hardcode colors.
9. **No new dependencies without justification.** `mammoth`, `chokidar`, `express`, `yaml` are already available.
10. **Preserve the single-page model** unless a doc explicitly asks for routing. No router has been added yet.

## When you finish a task

- Update the relevant doc in this folder if behavior or APIs changed.
- If you added a new architectural piece (new endpoint, new view, new DB column), add a one-line entry to the doc covering it.
- Never commit unless the user explicitly asks.
