# PowerPoint (.pptx) Support — Implementation Guide

Goal: make `.pptx` files first-class in Panopticon. They appear in the grid with a word count and excerpt, contribute slide titles to the **Question** dropdown, and render in the preview pane as a vertically-scrollable strip of per-slide PNG images produced by PowerPoint COM (driven from a PowerShell script). Text bits use pure-JS zip+XML extraction (no Office required); image rendering requires PowerPoint installed locally (the teacher already has it).

> Read [`../conventions.md`](../conventions.md) and [`../architecture.md`](../architecture.md) first. This file is the design + build log for `.pptx` support.

---

## 0. Assumptions surfaced (correct any before approving)

- **Dependency:** add `jszip` as a top-level dep. Conventions forbid new top-level deps without an explicit ask — surfaced as the lead question at the bottom of this doc. Alternatives (hand-rolled zip reader, `unzipper`, `adm-zip`) are all worse: `jszip` is the de-facto standard, zero native deps, pure JS, ~150 KB unpacked, used by Office.js itself.
- **PowerPoint COM is Windows-only and requires Office.** When COM rendering fails (non-Windows, no Office, or PowerShell error) the preview shows a clear empty state with "Open in PowerPoint" — text excerpts and slide titles still work because they come from the pure-JS path. Graceful, not a crash.
- **Render strategy:** per-deck, one-shot PowerShell process per render. Synchronous in the preview endpoint. ~3–5 s on first open of a deck; cached on disk forever after (invalidated on `mtime`/size change). No long-lived COM worker for v1 — easy to add later if open-multiple-decks UX gets painful.
- **Question dropdown source:** the existing "pick first `.docx` as representative" pattern in `AssignmentMonitor.svelte` extends to "pick first `.docx` OR `.pptx`, preferring `.pptx` when present". In mixed-type assignments the dropdown shows slide titles when any pptx exists; otherwise docx headings as today.
- **Cache location:** `data/pptx-cache/<submission_id>/slide-001.png`. `data/` is already gitignored. Cleaned on `mtime`/size change and on `deleteById`.
- **Out of scope explicitly:** `.ppt` (legacy binary), `.ppsx`, `.pptm`, animations/transitions, speaker notes, slide thumbnails on cards. All ship-later candidates.

---

## 1. UI plan

The grid changes nothing structural. Cards for `.pptx` rows render exactly like `.docx` rows — student name, activity dot, kind badge, word count, excerpt, filename, relative time. The excerpt is the first ~220 chars of every slide's text joined by spaces, so the teacher sees what the student wrote without opening the deck.

The preview pane gains a third `preview-content` variant alongside `html` (docx) and `binary` (PDF/image). For `.pptx`:

```
┌─────────────────────────────────────────────────────┐
│  Emma Wilson  DRAFT   syncing…                       │
│  Week 3 / Slides · Emma_Week3.pptx                   │
│  9 Digital Tech 1A · modified 12:38 PM               │
│                              [Open in PowerPoint]    │
├─────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────┐    │
│  │ Slide 1 — Welcome                            │    │
│  │  [rendered PNG, full deck width]             │    │
│  └─────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────┐    │
│  │ Slide 2 — Background                         │    │
│  │  [rendered PNG]                              │    │
│  └─────────────────────────────────────────────┘    │
│  …                                                   │
└─────────────────────────────────────────────────────┘
```

- Each slide is an `<img>` wrapped in a `<figure>` with a caption.
- The `<figure>` carries `data-heading-id="slide-N"` so the existing `scrollToHeading` plumbing in `DocPreview` already syncs the Question dropdown to the right slide.
- While rendering is in progress, the preview shows the standard "Loading preview…" copy. First open of a deck blocks the response for 3–5 s; subsequent loads are <100 ms (served from disk cache).
- Tokens reused: `--surface`, `--surface2`, `--border`, `--muted`, `--accent`. No new tokens.

### Question dropdown change

Already accepts a generic `Heading[]`. Slide titles become `{id: "slide-1", level: 1, text: "Welcome"}` entries. The dropdown's indentation (`(level - 1) * 2`) gives no extra indent for slides since they're all level 1 — matches what a teacher expects: a flat list of slide titles.

### Empty states (per-pptx, mirrors docx)

| `excerpt_status` | Card copy |
|------------------|-----------|
| `ok` | extracted text excerpt |
| `not_downloaded` | OneDrive 0-byte placeholder copy (reuse existing) |
| `empty_body` | "This deck has no text content yet — student may have only added images, or hasn't started typing." (new pptx-specific copy) |
| `missing` | reuse existing |
| `parse_error` | "Couldn't read this PowerPoint file. Open in PowerPoint to inspect." |

Preview pane gains one new variant: `{type:"empty", reason:"render_unavailable", message:"PowerPoint isn't installed (or rendering failed). Use Open in PowerPoint to view the slides."}`. Two-button layout (`Re-check file`, `Open in PowerPoint`) reusing the existing `.empty-state` block.

---

## 2. Non-goals

- Editing slides, annotating, or any write-path to .pptx.
- Slide thumbnails on the student response cards (excerpt-only there; the preview is where slides live).
- Non-Windows or no-Office visual rendering (degraded "open externally" UX instead).
- `.ppt` (legacy binary OLE), `.ppsx` (slideshow), `.pptm` (macro-enabled). All technically renderable by COM but out of scope until we hear they're needed.
- Slide animations, transitions, embedded video, or interactive content in the rendered images.
- Speaker notes extraction (could extend `slideXml.notesText` later).
- A long-lived COM worker / render queue. Per-call PowerShell spawn for v1.

---

## 3. Gap analysis vs current code

### Already in place — reuse, do not rebuild

| Capability | Where |
|------------|-------|
| `DocStats` shape (`word_count`, `excerpt`, `excerpt_status`) + cache by `(id, mtime, size)` | `server/src/metrics.ts` |
| `Heading` shape + `getStructure` cache by `(id, mtime)` + `invalidateStructure` | `server/src/structure.ts` |
| `PreviewResult` discriminated union + `buildPreview` extension switch | `server/src/preview.ts` |
| `DocPreview.svelte` html / binary / empty / unsupported branches + `scrollToHeading` effect | `src/components/DocPreview.svelte` |
| Question dropdown sources from `headings: Heading[]` generically | `src/components/SelectionBar.svelte`, `src/views/AssignmentMonitor.svelte` |
| Responses pipeline already calls `getDocStats(row.id, row.absolute_path, row.extension, row.last_modified_at)` — works as-is the moment `metrics.ts` understands `.pptx` | `server/src/routes.ts` `pickLatestPerStudent` consumer |
| `invalidateDocStats(id)` + `invalidateStructure(id)` are called from the watcher's `unlink` path | `server/src/watcher.ts` (Phase 2.5) |
| File streaming endpoint (`/api/file/:id`) + `Open in <app>` (`/api/open/:id`) | `server/src/routes.ts` |
| `parser.ts` already treats every extension equally — no allow-list to update |
| `data/` is gitignored, safe to drop a `pptx-cache/` under it |

### Genuinely missing — must be built

| Gap | Will land in | Step |
|-----|--------------|------|
| Pure-JS zip+XML extractor: per-slide text + slide titles | `server/src/pptx.ts` (new) | Step 2 |
| `getDocStats` branch for `.pptx` calling the new extractor | `server/src/metrics.ts` | Step 3 |
| `getStructure` branch for `.pptx` returning slide titles | `server/src/structure.ts` | Step 3 |
| PowerShell driver script invoked by Node | `scripts/render-pptx-slides.ps1` (new) | Step 4 |
| Node-side render dispatcher + on-disk cache management | `server/src/pptx-render.ts` (new) | Step 4 |
| New `PreviewResult` variant `{type:"slides", slides: [...]}` + new `empty` reason `render_unavailable` | `server/src/preview.ts` + `server/src/types.ts`? (kept inline in preview.ts — same as docx) | Step 5 |
| Pptx branch of `buildPreview` (text-only fallback if render fails) | `server/src/preview.ts` | Step 5 |
| Streaming endpoint for a single slide PNG | `server/src/routes.ts` — new `GET /api/preview/:id/slide/:n` | Step 5 |
| Cache eviction on `unlink` (delete `data/pptx-cache/<id>` dir) | `server/src/pptx-render.ts` exports `invalidatePptxCache(id)`; `server/src/watcher.ts` `processDelete` calls it alongside `invalidateDocStats` / `invalidateStructure` | Step 4 + Step 6 |
| Client mirror of new preview variant | `src/lib/api.ts` `PreviewResponse` union | Step 7 |
| Client preview rendering for `slides` variant | `src/components/DocPreview.svelte` | Step 7 |
| Representative-pptx selection for Question dropdown | `src/views/AssignmentMonitor.svelte` `loadHeadings` | Step 7 |
| Docs: api.md, data-model.md (cache section), glossary, README routing | `docs/reference/*.md`, `docs/README.md` | Step 8 |

---

## 4. Architecture changes

### New files

```
server/src/
├── pptx.ts                       # extractPptxText + extractPptxSlideTitles (jszip + regex over XML)
├── pptx.test.ts                  # unit tests (build a minimal pptx in-memory with jszip)
├── pptx-render.ts                # renderPptxSlides + invalidatePptxCache (spawns PowerShell)
scripts/
└── render-pptx-slides.ps1        # PowerPoint COM driver: opens deck, exports PNGs, exits
```

`pptx-render.ts` deliberately has no `.test.ts` — it requires PowerPoint installed and is exercised by the manual recipe in §6.

### Modified files

- `server/src/metrics.ts` — extend `computeStats` switch from "docx OR everything-else" to "docx | pptx | everything-else". Pptx branch reads the file, calls `extractPptxText`, derives `word_count` / `excerpt` / `excerpt_status` the same way docx does (including `empty_body`, `not_downloaded`, `parse_error`). Cache by-id stays identical.
- `server/src/structure.ts` — extend `computeStructure` with a `.pptx` branch that calls `extractPptxSlideTitles`, mapping each to `{id: "slide-N", level: 1, text}`. Slug rules unchanged (deterministic, dedupe with `-2`, `-3`).
- `server/src/preview.ts` — pptx branch: parse the deck for slide count (cheap, jszip again), produce render output via `renderPptxSlides`, return `{type:"slides", slides:[{index, title, image_path}]}`. If render fails: return `{type:"empty", reason:"render_unavailable", message}`. If pptx is 0 bytes: existing `not_downloaded` empty variant.
- `server/src/routes.ts` — add `GET /api/preview/:id/slide/:n`. Looks up the submission, sanity-checks `n` against the rendered cache, streams the PNG with `Content-Type: image/png`, `Cache-Control: public, max-age=31536000, immutable` (since the URL embeds mtime as a query param the client appends).
- `server/src/watcher.ts` — `processDelete` calls `invalidatePptxCache(id)` alongside the existing cache invalidators.
- `src/lib/api.ts` — extend `PreviewResponse` union with the new `slides` variant. Update `ExcerptStatus`? No — pptx reuses the existing statuses. Add `pptxSlideUrl(id, n, mtime)` helper.
- `src/components/DocPreview.svelte` — render `preview.type === "slides"` as the scrollable strip described in §1. Each `<figure data-heading-id="slide-N">` so `scrollToHeading` continues to work. Header "Open in Word" button text becomes "Open in PowerPoint" when extension is `.pptx`.
- `src/views/AssignmentMonitor.svelte` — `loadHeadings` picks the first response with `extension === ".pptx"` first; falls back to `.docx`. (Pptx representative wins because slide titles are usually more reliably present than docx headings.)

### New API endpoint

```
GET /api/preview/:id/slide/:n
```

- Path params: `id` is the submission id; `n` is 1-indexed slide number.
- Query params: `v` (optional cache-buster; the client passes `last_modified_at`).
- Response: binary `image/png` stream of the cached slide PNG.
- Errors: `404` if submission unknown, `404` if slide out of range, `503` if render hasn't completed or failed (with `{error}` JSON body).
- Caching: `Cache-Control: public, max-age=31536000, immutable`. Safe because the client always appends a `v=` query of the current `last_modified_at` and any change invalidates the cache.

The `GET /api/preview/:id` endpoint is **synchronous** for pptx — it renders (if not cached), then returns the `slides` JSON. First open blocks ~3–5 s; subsequent loads <100 ms. Same UX as a slow image source for the user: they see "Loading preview…" until it arrives.

### New SSE events

None. Render completion is signaled by the synchronous response of `/api/preview/:id`. SSE stays as today.

### No DB columns

Everything new is derived, cached on disk or in memory. No schema change.

### Cache on disk

```
data/pptx-cache/<submission_id>/
├── manifest.json     # { mtime_iso, size_bytes, slide_count, titles: string[] }
├── slide-001.png
├── slide-002.png
└── ...
```

- `manifest.json` is checked before re-rendering. Render is skipped if `mtime_iso` and `size_bytes` match.
- `invalidatePptxCache(id)` does `fs.rmSync(dir, {recursive:true, force:true})`.
- `data/pptx-cache/` is created lazily on first render. `data/` is already gitignored.

---

## 5. Implementation order

Each step is independently mergeable. Run `npm run typecheck` and `npm test` between them.

### Step 1 — Add `jszip` dependency ✅ DONE (2026-05-27)

- `jszip ^3.10.1` added to top-level `dependencies` via `npm install jszip`.
- **Surprise (worth noting):** jszip was already on disk transitively via mammoth, so the install was 0 new files — just a `dependencies` row in `package.json` and a `package-lock.json` rewrite. Same version `mammoth` was already pulling in, so no risk of two jszips in node_modules.
- Typecheck + 51 existing tests still green.

### Step 2 — `server/src/pptx.ts` + tests ✅ DONE (2026-05-27)

- `extractPptxText` + `extractPptxSlideTitles` shipped per spec (regex pair, numeric slide sort, no XML parser).
- 12 unit tests in `pptx.test.ts`, all green. Decks built in-memory with jszip; nothing committed binary.
- `ctrTitle` placeholder handled alongside `title` (covered by dedicated test). Single quotes on the `type=` attribute also accepted (`type=["']...["']`).

### Step 3 — Wire pptx into `metrics.ts` + `structure.ts` ✅ DONE (2026-05-27)

- `metrics.ts` refactored: extracted `computeDocxStats`, added `computePptxStats`, both sharing a new `statsFromText` helper so the word-count + excerpt + `empty_body` logic is in one place. Reduced the failure-state branching from two near-identical try-blocks to one common path.
- `structure.ts` `computeStructure` extended; pptx branch returns `slide-<N>` headings at level 1.
- `metrics.test.ts`: +2 tests (missing pptx, real on-disk pptx end-to-end via tmp file). `structure.test.ts`: +1 test (real on-disk pptx, mixing title-placeholder + fallback). Test count 51 → 63 → 66.
- After this step the grid + Question dropdown already work end-to-end for pptx with no COM, no preview-pane changes. The Mergeable Step claim holds — confirmed by running the typecheck + suite between Step 3 and Step 4.

### Step 4 — PowerShell COM render driver ✅ DONE (2026-05-27)

Shipped per spec, with these tightenings made during implementation:

- **Parameter rename:** the PS script's input parameter is `-InputPath`, not `-Input` (collides with the PowerShell automatic `$Input` enumerator). `pptx-render.ts` passes `-InputPath` to match.
- **`WithWindow=$true`** (not `$false`). Modern PowerPoint silently fails or COMExceptions on `Slide.Export` when the deck was opened with `WithWindow=$false`. Brief window flash is the cost; the script returns immediately so it's noticeable but not disruptive.
- **Native aspect ratio honoured:** the export height is computed from the deck's `PageSetup.SlideHeight / SlideWidth` rather than passing `0`. Handles 4:3, 16:9, and custom-sized decks (some teachers use square slides for social-media-style assignments).
- **Won't quit a user's PowerPoint:** if the teacher already had PowerPoint open we attached to that instance via COM; `$ppt.Quit()` is now guarded by `if ($ppt.Presentations.Count -eq 0)` so closing our temporary deck doesn't shut their session.
- **`pptxSlideStream(id, n)`** helper added to `pptx-render.ts` (didn't exist in the spec) so `routes.ts` mirrors the existing `getFileStream` pattern from `preview.ts` instead of importing `fs` directly.
- Module has no `.test.ts` per plan; manual recipe in §6 covers it.

### Step 5 — Preview endpoint + slide streaming endpoint ✅ DONE (2026-05-27)

Shipped per spec. Notes:

- **Extracted `buildPptxPreview`** as a helper inside `preview.ts` rather than inlining into the giant `if (ext === ".pptx")` block, so the docx and pptx branches stay symmetric and the file is still readable.
- **No `503`** for "render hasn't completed". Render is synchronous in `/api/preview/:id` — by the time the client knows about the slide URLs, the PNGs are on disk. The slide route returns `404` if a PNG isn't there (covers race conditions like a user deleting the cache dir mid-session).
- **`SlideRef`** interface lives in `preview.ts` (server) and `src/lib/api.ts` (client). Both name the field `image_path` — `snake_case` on the wire, per the conventions doc.
- Empty-deck (`slide_count: 0`) gets the `empty_body` reason rather than `render_unavailable`, since the render succeeded — the deck simply had no slides.

### Step 6 — Watcher cleanup on delete ✅ DONE (2026-05-27)

One-liner added to `processDelete` alongside the existing invalidators. No test churn — `watcher.test.ts` still green.

### Step 7 — Client: PreviewResponse + DocPreview render path + monitor picker ✅ DONE (2026-05-27)

Shipped per spec. Notes:

- **`SlideRef`** mirrors the server interface verbatim. New union variant is `{ type: "slides"; slides: SlideRef[]; last_modified_at: string }`.
- **`slideUrl(image_path, mtime)`** helper added — single source of truth for the `?v=` cache-buster appending.
- **`previewHtmlEl` reused** as the bind target for both `<div class="preview-html">` (docx) and `<div class="preview-slides">` (pptx). Mutually-exclusive `{#if}` branches mean only one element is mounted at a time, so the existing `scrollToHeading` effect works for both without changes. Each `<figure>` carries `data-heading-id="slide-N"` matching the `getStructure` slug — slide-jump from the Question dropdown works on the very first iteration.
- **`openAppLabel`** derived state keys off `submission.extension`: `.pptx` → "Open in PowerPoint", `.docx` → "Open in Word", else "Open externally". Applied to the header button + the two empty-state / unsupported-error fallback buttons.
- **`AssignmentMonitor.loadHeadings`** picks `.pptx` first, then `.docx`.

### Step 8 — Docs ✅ DONE (2026-05-27)

All six doc surfaces updated:

- `docs/reference/api.md` — `slides` preview variant + `render_unavailable` reason + `GET /api/preview/:id/slide/:n` endpoint.
- `docs/reference/data-model.md` — pptx cache row in the "Caches that look like data" table, noting the on-disk persistence across process restarts.
- `docs/reference/glossary.md` — new **Slide title** entry above **Scratch**.
- `docs/README.md` — row in **By feature area** pointing here.
- `docs/conventions.md` — `extractPptxText` / `extractPptxSlideTitles` / `renderPptxSlides` / `pptxSlideStream` / `invalidatePptxCache` added to the "Reuse before you build" table.
- `docs/features/live-monitor.md` — one-line note in Step 9 that pptx slide titles populate the Question dropdown and the picker prefers pptx over docx.

---

## 6. Verification

### Unit tests (Vitest)

| File | Coverage |
|------|----------|
| `server/src/pptx.test.ts` (new) | text extraction, title extraction, numeric slide sort, empty deck, entity decoding, sub-cases above |
| `server/src/metrics.test.ts` (extended) | `.pptx` extension gating (no longer "unsupported_ext"); success path with a jszip-built fixture; cache key still includes size |
| `server/src/structure.test.ts` (extended) | `.pptx` returns slide-N ids at level 1; empty deck → `[]` |

No new test infrastructure required (jszip works in the Node Vitest environment; no DOM needed).

### Scratch scripts

`scratch/check-pptx-render.mjs` (gitignored, kept across the build):

```js
const id = process.argv[2]; // a real pptx submission id from your DB
const res = await fetch(`http://127.0.0.1:8765/api/preview/${id}`);
const data = await res.json();
console.log("type:", data.type);
if (data.type === "slides") console.log(`slides: ${data.slides.length}`);
```

Run with `node scratch/check-pptx-render.mjs <id>` after starting `npm run dev`.

### Manual browser recipe

1. `npm run dev`. Open http://localhost:5173. Switch to **Live Monitor**.
2. Pick a class + assignment that contains at least one `.pptx` submission. Expect: that student's card shows a word count and a real excerpt (not "Preview not available for .pptx files").
3. Click the card. Expect: preview pane shows "Loading preview…" for 3–5 s on first open, then a vertical strip of slide images with captions ("Slide 1 — Welcome", etc.).
4. Click the card again to re-load (or pick a different student then return). Expect: <500 ms reload (served from `data/pptx-cache/<id>/`).
5. Open the **Question** dropdown. Expect: entries match the deck's actual slide titles (with "Slide N" fallback for untitled slides). Select one. Expect: the preview scrolls to that slide.
6. With the preview open, edit and save the underlying `.pptx` in PowerPoint (so the SSE event fires). Expect: card pulses, word count updates, preview shows "syncing…" pill then re-renders the deck (3–5 s render again because mtime changed). Cache for the old mtime is gone after rendering completes.
7. Delete the `.pptx` from disk. Expect: card disappears (Phase 2.5 path) and `data/pptx-cache/<id>/` is removed.
8. On a machine without PowerPoint (or simulate by renaming `powershell.exe` out of PATH for one terminal): expect the card text/excerpt still works; preview pane shows the `render_unavailable` empty state with two buttons.

### SSE verification

No new events; reuses the existing path. The Step 5 manual recipe step 6 is the SSE check.

### Pre-flight

- `npm run typecheck` passes.
- `npm test` passes (51 + N new — N ≈ 6–8 from the new pptx tests + extended ones).
- No leftover `console.log`.
- `scratch/` not committed.
- `docs/reference/api.md` and `data-model.md` reflect the new preview variant + cache.

---

## 7. Open product decisions

1. **`jszip` as a top-level dep.** Default: yes (only real option for clean zip reading in Node without native deps; ~150 KB pure JS). **Needs explicit user OK before Step 1** per conventions.
2. **Per-call PowerShell spawn vs persistent worker.** Default: per-call (simpler, acceptable 3–5 s latency on first open of a deck, instant after cache). Rationale: never paid by the card/grid; only by the user opening a preview. Easy to swap for a long-lived worker if open-many-decks UX gets slow.
3. **Synchronous render in the preview endpoint vs async + polling.** Default: synchronous. Rationale: client already shows "Loading preview…" and pptx is the only path that takes >500 ms. Async + SSE doubles the surface area for one occasional 5 s wait. Revisit if teachers complain.
4. **Question dropdown source priority in mixed-type assignments.** Default: prefer `.pptx` over `.docx` when both exist. Rationale: slide titles are reliable; docx heading styles often aren't. Easy to flip.
5. **Render width 1600 px.** Default chosen as a balance between fidelity (4K slides exist but few teachers need that) and disk + render time. Easy to flip via a constant in `pptx-render.ts`.
6. **Cache lifetime — never expires until invalidated.** Default. Aligns with `getDocStats` / `getStructure` behaviour. The teacher can `rm -rf data/pptx-cache` to nuke if it ever gets stale or large.

---

## 8. Definition of done

- [x] All eight steps shipped, each independently mergeable.
- [x] `npm run typecheck` passes.
- [x] `npm test` passes — 51 → 66 (15 new tests across `pptx.test.ts`, `metrics.test.ts`, `structure.test.ts`).
- [x] `pptx.test.ts` exists and covers the cases in §6.
- [ ] Manual recipe steps 1–8 all pass on the dev machine (PowerPoint installed). **— pending teacher's machine; cannot be exercised from this agent session, no test pptx in tree.**
- [ ] Recipe step 8 (no-PowerPoint) shows the graceful `render_unavailable` state. **— same caveat; relies on a runtime where PowerPoint isn't installed.**
- [x] `docs/reference/api.md`, `data-model.md`, `glossary.md`, `README.md`, `conventions.md`, `features/live-monitor.md` all updated.
- [x] `jszip` is the only new top-level dep (and was already on disk transitively via mammoth, so the lockfile delta is tiny).
- [x] No `console.log` debris.
- [x] No `scratch/` or `data/` artifacts committed.

---

## 9. Changelog

- `2026-05-27` — Initial implementation (Steps 1–8). All automated checks green (typecheck + 66 vitest tests). Manual browser recipe still owed by the teacher because it requires a real .pptx submission in a watched class folder — script `scratch/check-pptx-render.mjs` is described in §6 to make that quick.
- `2026-05-27` — Browse mode parity: `App.svelte` loads structure for the selected `.docx` / `.pptx`, shows a Slide/Question dropdown above `DocPreview`, and passes `scrollToHeading` so pptx slide-jump matches Live Monitor.
