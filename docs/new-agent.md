# New Agent — Kickoff Workflow

You are a fresh agent starting a new feature or fix on Panopticon. Follow these steps **in order**. Do not skip ahead.

The user will describe the feature/fix in their `/new-agent` prompt. The rest of this doc is your workflow.

---

## Step 0 — Orient yourself (always)

Read these two files **fully** before doing anything else:

1. [`conventions.md`](./conventions.md) — hard rules. Non-negotiable.
2. [`architecture.md`](./architecture.md) — system overview, file map, data flow.

Then skim [`reference/glossary.md`](./reference/glossary.md) so you don't misuse terms like *class*, *assignment*, *kind*, *watch root*.

**Do not read every feature doc.** Use the routing table next.

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

Before writing feature code, decide **how you will know it works**. See [`workflows/testing.md`](./workflows/testing.md) for the patterns Panopticon uses. At minimum:

- **Server change**: a `scratch/` script (`.mjs` or `.ts` via `tsx`) that hits the endpoint or calls the function in isolation, and prints expected vs actual.
- **Client change**: a manual reproduction recipe (steps in the browser, network tab checks, expected SSE behaviour).
- **Both**: do both.

Also make sure you can run the app in dev:

```powershell
npm install
npm run dev    # server on :8765, vite UI on :5173
```

If the dev server crashes on startup, **fix that first** — never try to add features on top of a broken baseline. See [`workflows/debugging.md`](./workflows/debugging.md).

You don't need a passing automated test before coding, but you need a way to demonstrate the change works that doesn't rely on "trust me".

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
2. Run `npm run typecheck`. Fix errors before continuing.
3. Exercise your verification recipe from Step 3.
4. Update the feature doc to mark that step done (with a date and any deviations from the original plan).
5. Move to the next step.

Hard rules during implementation (see [`conventions.md`](./conventions.md) for the full list):

- **Reuse existing components and CSS tokens.** Especially `DocPreview.svelte`, `--accent`, `--new`, etc.
- **No new top-level dependencies** without asking the user.
- **`snake_case` on the wire and in the DB.** TypeScript types follow the DB.
- **SSE first, polling only as fallback.**
- **Don't delete Browse mode** or other existing user-visible surfaces unless the user said so.

---

## Step 6 — Finish

Before declaring complete:

- [ ] `npm run typecheck` passes.
- [ ] Your verification recipe from Step 3 succeeds.
- [ ] The feature doc reflects what shipped, including any plan deviations.
- [ ] If you touched the API or DB, [`reference/api.md`](./reference/api.md) / [`reference/data-model.md`](./reference/data-model.md) is updated.
- [ ] If you introduced a new feature doc, the routing table in [`README.md`](./README.md) has a row for it.
- [ ] No `console.log` debris in committed code.
- [ ] No new files under `scratch/` are staged for commit (scratch is gitignored).

**Do not commit unless the user explicitly asks.** When they do ask, follow the git rules in your system instructions.

---

## Anti-patterns to avoid

- **Reading the entire docs folder before starting.** Use the routing table.
- **Building things the codebase already has.** Always grep first. The most common waste is reimplementing `DocPreview` loading logic, SSE subscription, or summary aggregation.
- **Renaming DB-backed fields to camelCase on the wire.** Don't.
- **Adding a new top-level dependency to do something `mammoth`, `chokidar`, `express`, or `yaml` already do.**
- **Polling at short intervals.** SSE is wired end-to-end. Use it.
- **Inventing test infrastructure.** There's no test runner yet; use the `scratch/` pattern.
- **Skipping the STOP gate in Step 4.** It's there because it works.
