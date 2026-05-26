# Feature Name — Implementation Guide

> Copy this file to `docs/features/<your-feature>.md`, delete this blockquote, then fill the sections in order. Add a row to the routing table in [`../README.md`](../README.md) when you create it.

Goal (one paragraph): what the feature does, who it's for, and why it's worth building. No solution detail yet.

> Always read [`../conventions.md`](../conventions.md) and [`../architecture.md`](../architecture.md) before working on this feature.

---

## 1. UI plan (if user-facing)

Sketch the layout. ASCII art is fine. Be specific about:

- Where the feature appears (existing view, new view, modal, etc.).
- What changes about the existing UI.
- Visual states (loading, empty, error, success, "live", etc.).
- Tokens reused from `src/app.css`. Any new tokens go in a list here.

If the feature is server-only, replace this section with a short data-flow diagram.

---

## 2. Non-goals

Explicit list of things this feature does **not** do. Use this to push back against scope creep later.

- …
- …

---

## 3. Gap analysis vs current code

Two tables. Be honest — most features can reuse more than the original plan assumed.

### Already in place — reuse, do not rebuild

| Capability | Where |
|------------|-------|
| … | `path/to/file.ts` |

### Genuinely missing — must be built

| Gap | Will land in | Step |
|-----|--------------|------|
| … | `path/to/file.ts` | Step N |

---

## 4. Architecture changes

### New files

```
src/
├── …
server/src/
├── …
```

### Modified files

List each file you'll touch and the one-line reason.

### New API endpoints

Each new endpoint gets:

- Method + path.
- Query / path parameters.
- Request body (if any).
- Response shape (JSON).
- Caching / invalidation rules.

Mirror the shape in [`../reference/api.md`](../reference/api.md) when you ship.

### New DB columns or tables

If any. Include the migration recipe from [`../reference/data-model.md`](../reference/data-model.md#migrations).

### New SSE events

If any. Show the payload type and where on the client it's consumed.

---

## 5. Implementation order

Each step must be **independently mergeable**. Don't start step N+1 with step N broken.

### Step 1 — short title

What you're doing. Files touched. Acceptance: how you verify this step in isolation.

### Step 2 — …

…

---

## 6. Verification

How a reviewer (or your future self) confirms the feature works.

- **Manual recipe** (browser): numbered steps with expected results at each.
- **Scratch script(s)**: paths in `scratch/`, one-line description of what each checks.
- **Typecheck**: `npm run typecheck` passes.

See [`../workflows/testing.md`](../workflows/testing.md) for the patterns.

---

## 7. Open product decisions

Things the user needs to decide before this is "done". Each item: question, default we picked if we had to ship today, rationale.

1. **…** — Default: …. Rationale: ….

---

## 8. Definition of done

The feature is complete when:

- [ ] All build steps shipped (one box per Step in §5).
- [ ] `npm run typecheck` passes.
- [ ] Manual verification recipe in §6 passes end-to-end.
- [ ] `../reference/api.md` updated if API changed.
- [ ] `../reference/data-model.md` updated if DB changed.
- [ ] `../reference/glossary.md` updated if new domain terms introduced.
- [ ] Routing table in `../README.md` lists this doc.
- [ ] No new top-level dependencies.
- [ ] No `console.log` debris.

---

## 9. Changelog

Append a one-line note when the feature changes after first ship. Dated.

- `YYYY-MM-DD` — Initial implementation (Steps 1–N).
- `YYYY-MM-DD` — …
