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

### Resuming an in-progress branch (opt-in only)

By default `/new-agent` always sets you up in a fresh worktree on a new branch off `main` (Step 2). You **do not** infer a resume from `git branch --show-current` — if you find yourself on a non-`main` branch unexpectedly, treat it as someone else's space and stop.

To resume in-progress work, the user must say so explicitly in the prompt:

> /new-agent — resume `feat/foo-bar`

If they did:

1. Identify the worktree for that branch via `git worktree list`. If it has one, the user should relaunch you inside that worktree; if it doesn't, ask whether to create one or work from the main checkout.
2. Verify `git status` is clean. If not, **stop and ask** — never carry someone else's uncommitted work along.
3. Read the matching `docs/features/<name>.md` to see which step the previous agent stopped at and what deviations they recorded.
4. Run `npm run typecheck` and `npm test` to confirm the baseline is healthy. If it isn't, fix that before adding anything new.

If the prompt doesn't include "resume", go to Step 2.

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

## Step 2 — Set up your sandbox (worktree + branch off `main`)

Every `/new-agent` run gets its own **worktree** and its own **branch**, both created off the current tip of `main`. The worktree gives you an isolated working directory; the branch gives you isolated commit history. Together they let multiple agents run against this repo without contending for HEAD.

Branch naming convention:

| Prefix | Use for |
|--------|---------|
| `feat/` | New user-facing feature or new API surface |
| `fix/` | Bug fix with no API change |
| `refactor/` | Internal restructure, no behaviour change |
| `docs/` | Docs-only change |
| `chore/` | Dependency bumps, gitignore, scripts |

Use kebab-case after the prefix. Examples: `feat/question-scroll-sync`, `fix/sse-reconnect-leak`.

### If you were launched in the main checkout (`git worktree list` shows one entry, `[main]`)

```powershell
# 1. Working tree clean? If anything is uncommitted that you didn't write
#    this session, STOP and ask the user.
git status

# 2. Sync main with origin. This is the only time you pull main.
git fetch origin
git switch main
git pull --ff-only

# 3. Create the worktree + branch in one command. If the branch name
#    already exists locally or on origin, suffix '-2', '-3', etc.
git worktree add -b <prefix>/<kebab-name> ..\Panopticon-<purpose> main

# 4. Open the new worktree in a fresh Cursor window. Requires `cursor` on
#    PATH (Command Palette -> "Shell Command: Install 'cursor' command in
#    PATH" if missing). Path needs quotes because of the "My Apps" space.
cursor "..\Panopticon-<purpose>"
```

Then **stop and ask the user to switch focus to the new Cursor window** that just opened (or to open `..\Panopticon-<purpose>` manually via File → Open Folder if the `cursor` launch failed) and re-invoke `/new-agent` there with `resume <branch>`. Don't try to continue from the main checkout — Cursor's working directory is fixed for the session and you can't reach into the new window's chat from here.

### If you were launched inside an existing worktree

Most agent sessions start here, because the user already created the worktree before invoking you.

```powershell
# Confirm you're in the right place.
git worktree list             # this directory should show with your branch
git status                    # must be clean
git branch --show-current     # should be your branch, not main
```

If `git status` is dirty with files you didn't write, **stop and ask**. If you're on `main` inside a worktree (rare, but possible), stop and ask the user to set up a branch.

### The branch is frozen

Once your branch is created, **do not** `git pull origin main`, `git merge main`, or otherwise pull in changes that landed on `main` after you started. The user handles reconciliation at `/end-agent` time. While you're running, your branch's view of the codebase is fixed at its starting commit.

If you genuinely need something that landed on `main` after your start (e.g. a new helper a previous agent shipped), **stop and ask the user** — don't pull it in unilaterally.

### Don't `git stash`

Worktree + branch + frozen-from-main means you never need to stash. If you need to pause your work — switching focus, the user asking you to detour, hitting a blocker — make a `wip: <one-line note>` commit on your branch instead. Future you can reword or squash it during `/end-agent`. Stashes hide state across sessions and have repeatedly caused this repo's worst git messes.

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
- **Branching off whatever is currently checked out.** Step 2 says branch off `main`, every time. Never branch off another agent's WIP.
- **Inferring a resume from HEAD position.** The user must say "resume `<branch>`" explicitly. Otherwise assume fresh-branch off `main`.
- **Pulling `main` into your branch mid-session.** Your branch is frozen at its start commit (Step 2). Reconciliation happens at `/end-agent` time, not by you.
- **Using `git stash`.** Use a `wip:` commit instead. See Step 2.
- **Running two agents in the same checkout.** Each agent gets its own worktree. See Step 2.
