# Testing Workflow

Panopticon uses **Vitest** for automated tests, plus **scratch scripts** and **browser recipes** for things that aren't unit-testable. Every change needs a verification recipe you can hand to a reviewer (or your future self) and reproduce on demand.

---

## 1. The four tiers

| Tier | When | Cost |
|------|------|------|
| **Typecheck** | After every code change. Free. | `npm run typecheck` |
| **Unit tests (Vitest)** | Any pure-function change or new pure helper. | `npm test` |
| **Scratch script** | When you need to exercise a function/route end-to-end (DB, mammoth, HTTP). | `npx tsx scratch/<name>.ts` |
| **Browser recipe** | Any user-visible behaviour change. | Manual |

Use as many tiers as apply. Most non-trivial PRs need typecheck + tests + at least one of the other two.

---

## 2. Typecheck

```powershell
npm run typecheck
```

Runs `tsc --noEmit` over the whole repo (server, client, svelte, vitest config). **Must pass before you declare a task done.**

---

## 3. Unit tests (Vitest)

```powershell
npm test            # one-shot run, exits non-zero on failure
npm run test:watch  # interactive watch mode for TDD
```

### Where tests live

Co-located with the source: `<name>.ts` ↔ `<name>.test.ts`.

```
server/src/
├── parser.ts
├── parser.test.ts          ← pure unit tests for parser.ts
├── structure.ts
├── structure.test.ts
├── metrics.ts
└── metrics.test.ts
```

The Vitest glob is `server/**/*.test.ts` and `src/**/*.test.ts` (see [`vitest.config.ts`](../../vitest.config.ts)).

### What to test

Test the **pure, deterministic** pieces that break silently:

- Pure functions (`parser.ts`, `structure.ts`).
- Cache behaviour (`metrics.ts`).
- Algorithms whose output the UI / API depends on byte-for-byte.

**Don't** try to unit-test:

- Network handlers — they're trivial Express wiring. Use a scratch script that hits the real route.
- Filesystem watchers — chokidar timing is hard to mock and easy to break. Use a manual recipe.
- Svelte components — we don't have `@testing-library/svelte` installed yet. If you need it, see "When to grow the test stack" below.

### Test conventions

- **File header comment**: short paragraph saying *what the module does* and *why these tests exist*. Future you will thank present you.
- **`describe` per function**, `it` per behaviour. Read the test name out loud — "it extracts h1, h2, h3 in document order".
- **One assertion per `it`** where reasonable. Group related assertions with `it.each(...)`.
- **No shared mutable state** between tests. If a module has a singleton cache (e.g. `metrics.ts`), reset it in `beforeEach`.
- **No fixtures committed as binaries.** `.docx` parsing is exercised by manual recipes, not by checking sample files into git. Test the wrapper around mammoth, not mammoth itself.

### Reference equality for cache tests

`getDocStats` and similar cached helpers always build a fresh result on a miss. So:

```ts
const a = await getDocStats(id, path, ext, mtime);
const b = await getDocStats(id, path, ext, mtime);
expect(b).toBe(a);   // same reference ⇒ cache hit
```

Use `toBe` (identity) for "cache hit", `toEqual` (deep equality) for "value matches".

---

## 4. Scratch scripts (the integration layer)

For anything that touches real files, the real DB, or the real HTTP server. Drop one-off scripts in `scratch/` (gitignored).

Naming: `scratch/<feature>-<what-it-checks>.{mjs,ts}`.

### 4.1 Import a server module directly

```ts
// scratch/check-pick-latest.ts
import { SubmissionStore } from "../server/src/db.js";

const store = new SubmissionStore();
const rows = store.list({
  watch_root_label: "9 Digital Tech 1A",
  assignment: "Week 3 homework",
});
console.log(`input rows: ${rows.length}`);
console.log(rows.slice(0, 3).map((r) => `${r.student} → ${r.filename}`).join("\n"));
store.close();
```

Run with:

```powershell
npx tsx scratch\check-pick-latest.ts
```

### 4.2 Hit the running server

```mjs
// scratch/check-responses-endpoint.mjs
const cls = encodeURIComponent("9 Digital Tech 1A");
const asgn = encodeURIComponent("Week 3 homework");
const res = await fetch(`http://127.0.0.1:8765/api/assignments/${cls}/${asgn}/responses?kind=working`);
const data = await res.json();
console.log(`rows: ${data.length}`);
console.log("students with no word_count:", data.filter(r => r.word_count == null).map(r => r.student));
console.log("sample:", data[0]);
```

```powershell
node scratch\check-responses-endpoint.mjs
```

### 4.3 Cleanup

`scratch/` is gitignored. When you finish a task, delete throwaway scripts. Useful ones can stay — name them clearly so the next agent can re-use them.

---

## 5. Browser recipes

For UI changes, write the recipe in the feature doc under a **Verification** section. Short enough to follow in two minutes, each step with an **expected** result:

```markdown
### Verification

1. `npm run dev`, open http://localhost:5173.
2. Switch to Live Monitor.
3. Pick "9 Digital Tech 1A" → "Week 3 homework".
4. Expect: 23 student cards, each with a non-zero word count.
5. Edit a `.docx` in OneDrive, save it.
6. Expect: within ~3 seconds the matching card pulses green and the word count updates.
7. Click a card → metrics panel populates on the right.
```

Vague recipes ("check it works") don't count.

---

## 6. SSE verification

Live updates are easy to break and hard to spot. When you touch anything in the event chain (`watcher.ts` → `events.ts` → `routes.ts` `/events` → `subscribeToEvents`), include this in your recipe:

```powershell
# In one terminal:
curl -N http://127.0.0.1:8765/api/events

# In another, trigger a file save:
echo "test" > "C:/path/to/9 Digital Tech 1A - Student Work/Working files/Test/Week 3/test.txt"
```

You should see a `submission-changed` payload within ~2 seconds. If you don't, the watcher debounce, EventBus, or SSE route is broken — not your feature.

---

## 7. When to grow the test stack

You **don't** need every change to have a Vitest test. Add new test infrastructure only when it pays off:

| Want to test | Install | Then |
|--------------|---------|------|
| Svelte components | `npm i -D @testing-library/svelte happy-dom` | Set `/// @vitest-environment happy-dom` at the top of the test file. |
| HTTP routes against a live Express app | (nothing — just use scratch scripts) | If scratch scripts become fragile, install `supertest` (`@types/supertest`) and write integration tests. |
| Real `.docx` parsing | (nothing) | Put a small sample under `scratch/fixtures/` (gitignored) and write a scratch script. Don't commit binary fixtures. |
| Snapshot HTML output | (built into Vitest) | `expect(html).toMatchInlineSnapshot()`. Use sparingly. |

If you add infra, update this doc in the same commit.

---

## 8. Pre-flight checklist before saying "done"

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] If you added a unit-testable function, you added a `.test.ts` for it.
- [ ] If you changed user-visible behaviour, the feature doc has a numbered browser recipe.
- [ ] No leftover `console.log` debris.
- [ ] No `scratch/` files committed (gitignored, but `git status` should confirm).
- [ ] If you changed `/api/*`, you also updated [`../reference/api.md`](../reference/api.md).
