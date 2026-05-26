# New Agent — Kickoff Workflow

You are a fresh agent starting a new feature or fix on Panopticon. Follow these steps **in order**. Do not skip ahead.

The user will describe the feature/fix in their `/new-agent` prompt. The rest of this doc is your workflow.

**This skill bookends with [`/end-agent`](./end-agent.md).** `/new-agent` covers: orient → plan → implement. `/end-agent` covers: finalise tests → clean up → docs → commit → merge → push. Don't run any of `/end-agent`'s steps from here — when you finish implementing, hand off and let the user invoke it.

---

## Step 0 — Orient yourself (always)

Read these two files **fully** before doing anything else:

1. [`conventions.md`](./conventions.md) — hard rules. Non-negotiable.
2. [`architecture.md`](./architecture.md) — system overview, file map, data flow.

Then skim [`reference/glossary.md`](./reference/glossary.md) so you don't misuse terms like *class*, *assignment*, *kind*, *watch root*.

**Do not read every feature doc.** Use the routing table next.

### Resuming an in-progress branch

If `git branch --show-current` returns a non-`main` branch and `git status` / `git log -3` show prior work, you're picking up where someone (or a previous agent) left off — **not** starting fresh:

1. Read the matching `docs/features/<name>.md` to see which step the previous agent stopped at and what deviations they recorded.
2. Run `npm run typecheck` and `npm test` to confirm the baseline is healthy. If it isn't, fix that before adding anything new.
3. If it's unclear where to resume — especially if the user's `/new-agent` prompt doesn't obviously match the in-progress branch — **stop and ask the user** whether to continue, abandon, or branch fresh from `main`.

---

## Step 1 — Identify relevant docs from the routing table

Open [`README.md`](./README.md) (this folder's index). Match the user's request against:

- The **By task type** table (e.g. "touching the DB schema").
- The **By feature area** table (e.g. live monitor view).
- The **Reference** table (e.g. need an endpoint shape → `reference/api.md`).

Read **only those docs**. If your task touches an existing feature, the corresponding `features/<name>.md` is mandatory; the others are not.

If no existing feature doc fits, you'll create one in Step 5 from [`features/_template.md`](./features/_template.md).

> If the task is ambiguous or could be done several ways, **stop here** and ask the user one or two targeted questions before reading more. Don't guess.

---

## Step 2 — Create a git branch

Branch naming convention:

| Prefix | Use for |
|--------|---------|
| `feat/` | New user-facing feature or new API surface |
| `fix/` | Bug fix with no API change |
| `refactor/` | Internal restructure, no behaviour change |
| `docs/` | Docs-only change |
| `chore/` | Dependency bumps, gitignore, scripts |

Use kebab-case after the prefix. Examples: `feat/question-scroll-sync`, `fix/sse-reconnect-leak`.

```powershell
git switch -c feat/<short-name>
```

If `main` has uncommitted changes from your previous task, **stop and ask the user**. Don't branch off a dirty tree.

---

## Step 3 — Set up a verification recipe

Before writing feature code, decide **how you will know it works**. See [`workflows/testing.md`](./workflows/testing.md) for the four tiers (typecheck, Vitest, scratch scripts, browser recipes). At minimum:

- **Pure helper or algorithm**: a Vitest file co-located with the source (`<name>.test.ts`).
- **Server change touching DB / FS / HTTP**: a `scratch/` script that hits the endpoint or calls the function with real data.
- **Client change**: a manual reproduction recipe (steps in the browser, network tab checks, expected SSE behaviour).

Also make sure you can run the app in dev:

```powershell
npm install
npm run dev    # server on :8765, vite UI on :5173
```

Confirm the existing test suite is green **before** you start changing things:

```powershell
npm test
npm run typecheck
```

If either fails, **fix that first** — never build on a broken baseline. See [`workflows/debugging.md`](./workflows/debugging.md).

---

## Step 4 — Plan the change, then STOP

Write a short plan **before** editing source files. The plan goes in one of two places:

- **Extending an existing feature**: append a new step or section to that feature's doc (`docs/features/<name>.md`).
- **Brand-new feature**: create `docs/features/<your-feature>.md` from [`features/_template.md`](./features/_template.md). Fill in:
  - Goal (one paragraph).
  - Non-goals (what you're explicitly *not* doing).
  - Gap analysis vs current code (cite files).
  - Step-by-step plan (each step independently mergeable).
  - Definition of done.

Then **STOP and confirm with the user** before implementing. Print the plan, ask:

> "This is the plan. Should I proceed, or do you want changes?"

This gate is cheap and catches misunderstandings before you've written 500 lines.

---

## Step 5 — Implement, in small steps

For each step from your plan:

1. Make the minimum change to land that step.
2. Run `npm run typecheck` and `npm test`. Fix failures before continuing.
3. Exercise your verification recipe from Step 3 (Vitest for pure logic, scratch script for integration, browser steps for UI).
4. Update the feature doc to mark that step done (with a date and any deviations from the original plan).
5. Move to the next step.

Hard rules during implementation (see [`conventions.md`](./conventions.md) for the full list):

- **Reuse existing components and CSS tokens.** Especially `DocPreview.svelte`, `--accent`, `--new`, etc.
- **No new top-level dependencies** without asking the user.
- **`snake_case` on the wire and in the DB.** TypeScript types follow the DB.
- **SSE first, polling only as fallback.**
- **Don't delete Browse mode** or other existing user-visible surfaces unless the user said so.

---

## Step 6 — Hand off to `/end-agent`

Once your implementation is working, **don't** commit, merge, or push from here. The user will invoke the `/end-agent` skill which runs the full wrap-up workflow:

- Backfills any missing tests.
- Cleans up debug code, runs the suite again.
- Updates docs.
- Commits, merges to `main`, pushes.

Your responsibility before handing off:

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] Your Step 3 verification recipe still succeeds end-to-end.
- [ ] The feature doc reflects what shipped, including any plan deviations.
- [ ] You've reported back to the user with a short summary of what changed and what they should test in the browser.

The end-agent flow lives at [`end-agent.md`](./end-agent.md) — read it if you're curious, but don't start running it yourself unless the user explicitly says "wrap up" / "ship it" / runs the `/end-agent` skill.

---

## Communication style

How to interact with the user across the whole flow:

- **One pointed question beats five assumptions.** If you're about to write code based on a guess, stop and ask first. Prefer multiple-choice phrasing where the options are real ("Should the new endpoint return one row per student or one row per file?") over open-ended.
- **Time-box exploration.** If you've read 8–10 files and still don't have a plan you're confident in, surface that to the user — don't read another 20 hoping the answer appears.
- **Surface assumptions explicitly in the plan.** Don't bury "I'm assuming X" inside step 7 of a long plan. State assumptions at the top so the user can correct them before the STOP gate.
- **Per-step reports are one line.** After each implementation step in Step 5, say what shipped and what's next. Don't re-ask for permission to continue if the plan was already approved.
- **Don't run state-changing git commands without an explicit signal from the user.** Reading is fine (`git status`, `git log`, `git diff`, `git branch`). Anything that changes state — `switch <other branch>`, `pull`, `stash`, `reset`, `commit`, `push`, branch deletion — needs a clear instruction. The relevant signal for wrap-up is the user invoking `/end-agent`.
- **Hand off explicitly when you finish implementing.** End your final message with something like: *"Implementation complete. Run `/end-agent` when you want to test, clean up, commit, merge, and push."* Don't quietly stop.

---

## Anti-patterns to avoid

- **Reading the entire docs folder before starting.** Use the routing table.
- **Building things the codebase already has.** Always grep first. The most common waste is reimplementing `DocPreview` loading logic, SSE subscription, or summary aggregation.
- **Renaming DB-backed fields to camelCase on the wire.** Don't.
- **Adding a new top-level dependency to do something `mammoth`, `chokidar`, `express`, or `yaml` already do.**
- **Polling at short intervals.** SSE is wired end-to-end. Use it.
- **Adding alternative test infrastructure.** Vitest is set up — write `*.test.ts` next to the source. Don't introduce Jest, Playwright, or anything else without a strong reason and an ask.
- **Running `/end-agent`-style commands yourself.** Commit / merge / push belong to the wrap-up skill. Hand off; don't pre-empt.
- **Declaring "done" on the user's behalf.** Your job ends with a hand-off; the user decides when to ship.
- **Skipping the STOP gate in Step 4.** It's there because it works.
