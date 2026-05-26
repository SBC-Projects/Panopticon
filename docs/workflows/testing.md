# Testing Workflow

Panopticon has **no automated test framework yet** — and that's intentional for now. The codebase is small enough that the cost of a test runner outweighs the benefit. What we do require is that **every change has a verification recipe** you can hand to a reviewer (or your future self) and reproduce on demand.

This doc describes the patterns we use.

---

## 1. The three tiers

| Tier | When |
|------|------|
| **Typecheck** | After every code change. Free. |
| **Scratch script** | Any time you've added a server function, helper, or endpoint that can be exercised without the UI. |
| **Browser recipe** | Any time the user-visible behaviour changed. |

Use as many as apply. Most non-trivial PRs need at least the typecheck + one of the other two.

---

## 2. Typecheck

```powershell
npm run typecheck
```

Runs `tsc --noEmit` over the whole repo (server + client + svelte). **Must pass before you call a task done.** It's the cheapest signal you have.

---

## 3. Scratch scripts (the closest thing we have to unit tests)

Drop one-off verification scripts in `scratch/` (gitignored). Naming convention: `scratch/<feature>-<what-it-checks>.mjs` or `.ts`.

Two patterns are common.

### 3.1 Import a server module directly

When you want to exercise a function without going through HTTP:

```ts
// scratch/check-pick-latest.ts
import { SubmissionStore } from "../server/src/db.js";
import { pickLatestPerStudent } from "../server/src/routes.js";  // export it first

const store = new SubmissionStore();
const rows = store.list({
  watch_root_label: "9 Digital Tech 1A",
  assignment: "Week 3 homework",
});
console.log(`input rows: ${rows.length}`);
const picked = pickLatestPerStudent(rows);
console.log(`one per student: ${picked.length}`);
console.log(picked.map((r) => `${r.student} → ${r.filename}`).join("\n"));
store.close();
```

Run with:

```powershell
npx tsx scratch\check-pick-latest.ts
```

If you need to import a private function, **export it temporarily** for the script and remove the export before the change ships (or keep the export if it's harmless).

### 3.2 Hit the running server

When you want to verify end-to-end (route + DB + SSE):

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

Run with:

```powershell
node scratch\check-responses-endpoint.mjs
```

This is the lighter-weight option and what we lean on most.

### 3.3 Cleanup

`scratch/` is gitignored (see [`conventions.md`](../conventions.md)). When you finish a task, consider deleting your scratch files — or leave the useful ones in place, named clearly, for the next agent.

---

## 4. Browser recipes

For UI changes, write the recipe in the feature doc itself, under a **Verification** section. The recipe should be short enough that a human can follow it in under two minutes:

```markdown
### Verification

1. `npm run dev`, open http://localhost:5173.
2. Switch to Live Monitor.
3. Pick "9 Digital Tech 1A" → "Week 3 homework".
4. Expect: 23 student cards, each with a non-zero word count and a 3-4 line excerpt.
5. Edit a `.docx` in OneDrive. Save. Within ~3 seconds the matching card pulses green and the word count updates.
6. Click a card → metrics panel populates on the right.
```

Each step has an **expected** result you can verify. Vague recipes ("check it works") don't count.

---

## 5. SSE verification

Live updates are easy to break and easy to miss. When you touch anything in the event chain (`watcher.ts` → `events.ts` → `routes.ts` `/events` → `subscribeToEvents`), include this in your recipe:

```powershell
# In one terminal:
curl -N http://127.0.0.1:8765/api/events

# In another, simulate or trigger a file save:
echo "test" > "C:/path/to/9 Digital Tech 1A - Student Work/Working files/Test/Week 3/test.txt"
```

You should see a `submission-changed` payload within ~2 seconds. If you don't, the watcher debounce, EventBus, or SSE route is broken — not your feature.

---

## 6. When to invest in a real test runner

Add Vitest **only** when one of these is true:

- A bug shipped that a tiny test would have caught, twice.
- The DB schema gets a second table and the SQL starts being non-trivial.
- A parser or transformer (e.g. `parseSubmissionPath`, `injectHeadingIds`) needs more than 3 unit-test-shaped checks.

Even then: install Vitest, add a `test` script, write a handful of tests in `server/src/*.test.ts`, and update this doc. Don't introduce a giant test apparatus for one assertion.

---

## 7. Pre-flight checklist before saying "done"

- [ ] `npm run typecheck` passes.
- [ ] At least one of: scratch script result pasted into your message, or a numbered browser recipe in the feature doc.
- [ ] No leftover `console.log`s.
- [ ] No `scratch/` files committed (they should be gitignored, but check `git status`).
- [ ] If you changed `/api/*`, you also updated [`../reference/api.md`](../reference/api.md).
