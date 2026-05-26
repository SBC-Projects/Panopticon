# Conventions — Hard Rules

Short list of rules that apply to **every** task. If you find yourself wanting to break one of these, stop and ask the user first.

---

## Stack — fixed

- **Server**: Node 22+, Express, `node:sqlite`, chokidar, mammoth, yaml. TypeScript via `tsx`.
- **Client**: Svelte 5 (runes: `$state`, `$derived`, `$effect`), Vite, TypeScript.
- **Tests**: Vitest, Node environment. Co-located `*.test.ts` files. See [`workflows/testing.md`](./workflows/testing.md).
- **No new top-level dependencies** without an explicit ask. Especially: no React, no Vue, no Tailwind, no ORM, no alternative test framework, no state-management library, no router.

---

## Naming

- **`snake_case`** on the wire (JSON), in the DB, and in the TypeScript types that mirror them. Examples: `watch_root_label`, `last_modified_at`, `submission_id`, `word_count`.
- **`camelCase`** for local variables and function names inside a single file.
- **`PascalCase`** for Svelte components, classes, and types/interfaces.
- **Files**: `kebab-case.ts` for libs (`api.ts`, `metrics.svelte.ts`), `PascalCase.svelte` for components.

If you're tempted to translate a DB field to camelCase on the way to the UI: don't. The pipeline is end-to-end `snake_case`.

---

## Domain terms (see [`reference/glossary.md`](./reference/glossary.md))

- **Class** = `watch_root_label`. There is no `classes` table.
- **Assignment** = derived from the filesystem path, identified by `(watch_root_label, assignment)`.
- **Kind** = `"submitted"` (turned in) or `"working"` (live draft). Every submission has one.
- **Watch root** = a `* - Student Work/Submitted files` or `Working files` folder on disk.

Don't invent synonyms.

---

## CSS

- **Use the tokens** in `src/app.css`: `--surface`, `--surface2`, `--border`, `--text`, `--muted`, `--accent`, `--new`, `--new-bg`, `--warn`.
- Don't hardcode colours, font sizes, or gaps that already have a token.
- New token? Add it to `app.css` with a one-line comment.
- Component styles go inside the component's `<style>` block. Scoped is fine; global is for `app.css` only.

---

## Live updates

- **SSE is the live channel.** `GET /api/events` is already running and tested. Subscribe from the client via `subscribeToEvents` in `src/lib/api.ts`.
- **Polling is fallback only.** The `App.svelte` 30 s timer is a safety net for SSE disconnect; do not add new poll loops for live-feeling features.
- When you add a new event type, extend the union in `server/src/events.ts` **and** `src/lib/api.ts`. Keep them in sync.

---

## Reuse before you build

These already exist. Use them.

| Need | Use |
|------|-----|
| Single-doc preview (HTML or binary) with stale-guard | `DocPreview.svelte` |
| Live SSE subscription | `subscribeToEvents` in `src/lib/api.ts` |
| Relative time / activity state / shared "now" ticker | `src/lib/metrics.svelte.ts` |
| File watcher | `SubmissionWatcher` in `server/src/watcher.ts` |
| In-process event bus | `EventBus` in `server/src/events.ts` |
| `.docx` text extraction + word count + excerpt | `getDocStats` in `server/src/metrics.ts` |
| `.docx` heading extraction | `getStructure` + `injectHeadingIds` in `server/src/structure.ts` |
| `Submission` filtering | `SubmissionStore.list` in `server/src/db.ts` |

Grep before you write.

---

## Anti-patterns

- ❌ Reimplementing preview loading in a second component.
- ❌ Renaming DB fields to camelCase in API responses.
- ❌ Adding a poll loop because "SSE is hard". It's already there.
- ❌ Adding a new dependency for word counting / file watching / yaml parsing / HTTP — they're already in the tree.
- ❌ Caching the entire submissions table in memory client-side. Fetch what you need.
- ❌ Stubbing fake data in the UI for future metrics. Use placeholder rows that say "Not available yet" (see `MetricsPanel.svelte`).
- ❌ Deleting Browse mode or the existing sidebar. Both views coexist.
- ❌ Adding routing. There's none, and nothing needs it yet.
- ❌ Committing without being asked.

---

## Definition of done — minimum bar

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] New pure helpers have a `*.test.ts` next to them.
- [ ] You can demonstrate user-visible changes work (browser recipe in the feature doc — see [`workflows/testing.md`](./workflows/testing.md)).
- [ ] Feature doc updated to reflect what shipped.
- [ ] `reference/api.md` and `reference/data-model.md` updated if applicable.
- [ ] No `console.log` debris.
- [ ] No accidental commits of `data/`, `dist/`, `config.yaml`, `scratch/`, or `node_modules/`.
