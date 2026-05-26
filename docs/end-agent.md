# End Agent — Wrap-up & Ship Workflow

You are wrapping up a feature or fix on Panopticon. The user has invoked `/end-agent` — that's your explicit consent to **test, clean up, document, commit, merge, and push**.

Follow the steps **in order**. Don't skip ahead. If anything fails, stop and report — don't try to commit a broken tree.

> If you haven't yet implemented the change, start with [`new-agent.md`](./new-agent.md) instead.

---

## Step 0 — Sanity-check the starting state

```powershell
git status
git log --oneline -5
git branch --show-current
git worktree list
```

Confirm:

- You are in a **worktree**, not the main checkout. `git worktree list` should show at least two entries; the one with `(current)` should not be the bare `[main]` entry. If you are in the main checkout, stop and ask the user how to proceed — `/end-agent` runs from inside the worktree the work happened in.
- You are on a **feature branch**, not `main`. If you're on `main`, stop and ask the user.
- `git status` is what you expect (your work is present; nothing weird is untracked).
- The latest commit on this branch is your work, not someone else's.

If the working tree has unrelated dirty files (anything you didn't write this session), **stop and ask the user** before continuing.

> Note the path of the main checkout from `git worktree list` — you'll need it in Step 6. Below, this doc uses `<main-path>` as a placeholder; it's typically `..\Panopticon`.

---

## Step 1 — Tests: backfill, then run

### 1a. Backfill any missing tests

For every **pure helper** you added or substantively changed this session, confirm there is a co-located `*.test.ts` file covering it. See [`workflows/testing.md`](./workflows/testing.md) for what is and isn't worth unit-testing.

Rule of thumb:

- Added/edited a pure function? It needs a test.
- Added/edited an Express route? Test the helpers it calls; the route itself is exercised by a scratch script or manual recipe (state which in the feature doc).
- Added/edited a Svelte component? No unit test needed yet — a browser recipe in the feature doc is enough.

If you're adding a test for a function the previous agent skipped, that's fine. Don't go on a wider archaeology mission than the diff in this branch.

### 1b. Run the full suite

```powershell
npm run typecheck
npm test
```

Both must pass with no failures, no skips, no warnings about misconfigured tests.

If either fails:

- **Fix** the failure (don't rationalise it).
- Re-run from scratch.
- Do **not** mark a test `.skip` or `.todo` to make the build green. If the test is wrong, fix or delete it. If the code is wrong, fix it.

---

## Step 2 — Clean up

Walk the diff and remove debris.

```powershell
git diff main...HEAD              # everything this branch adds vs main
git diff                           # uncommitted working-tree changes
```

Look for and remove:

- `console.log` / `console.warn` / `console.error` that was for debugging, not for users.
- Commented-out code blocks ("// old version, keep just in case"). Git remembers; delete it.
- Unused imports, unused variables, unused exports.
- TODO comments you wrote that you've actually done.
- Dead branches in `if/else` that only existed during exploration.
- Stray `debugger;` statements.
- Files in `scratch/` that ended up tracked by accident (`git ls-files scratch/` should print nothing — `scratch/` is gitignored).
- Personal data in fixtures or logs (real student names, real OneDrive paths in tests).

Leave **intentional** logs — the `New <kind>:` line in `server/src/index.ts`, the `[metrics]`/`[preview]` warnings — they earn their place. Remove only debris you added.

### 2a. If the cleanup turned into a refactor

If cleanup grew into a meaningful refactor (you moved code between files, renamed something exported elsewhere, restructured a component), **re-run the suite**:

```powershell
npm run typecheck
npm test
```

Both must pass again before you go to Step 3.

---

## Step 3 — Update docs

Match the changes in this branch against the doc set. Read [`README.md`](./README.md)'s routing table and update each row that's now stale.

Check each:

- **Feature doc** (`docs/features/<your-feature>.md`): is every step's status box accurate? Are deviations from the original plan noted? Append a dated line to the changelog at the bottom.
- **`reference/api.md`**: any new/changed endpoints, new query params, new response fields?
- **`reference/data-model.md`**: any new columns, types, or invariants?
- **`reference/glossary.md`**: any new domain terms that an agent six months from now wouldn't immediately understand?
- **`README.md`** (this folder): if you created a new feature doc, the routing table needs a row.
- **`how-to-use.md`**: if a user-visible workflow changed, the end-user guide needs updating.
- **`architecture.md`**: only if you added/removed a top-level file or changed a key invariant. Don't touch otherwise.
- **`conventions.md`**: only if you established a new convention worth enforcing across the codebase.

---

## Step 4 — Final self-review

One more pass through the full diff before commit. This is the cheapest bug-catcher you have.

```powershell
git diff main...HEAD
git status
```

Mental checklist:

- [ ] Does every changed file actually need to change?
- [ ] Anything checked in that shouldn't be? (`data/`, `dist/`, `config.yaml`, `scratch/`, `node_modules/`, `*.db`, real student `.docx` files, `.env*`)
- [ ] Any secrets, API keys, real names, or real paths in the diff? (We have none of these by design — flag immediately if you see one.)
- [ ] Does `git status` only show tracked files you intended to change?

If anything looks off, fix it before continuing.

---

## Step 5 — Stage and commit

### 5a. Stage

Stage only the files you intend to commit. Avoid `git add -A` blindly:

```powershell
git add <file1> <file2> ...
git status   # confirm exactly the right files are staged
```

Untracked files in `scratch/`, `data/`, `dist/`, `node_modules/` should be ignored already (see `.gitignore`). If something you don't recognise is staged, **stop**.

### 5b. Commit message

Format: `<type>: <imperative summary>` on the first line, blank line, then a short body explaining the **why** (not the what — the diff tells the what).

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `perf`.

```text
feat: jump preview to selected question heading

When a teacher picks a question in the Live Monitor selection bar,
DocPreview now scrolls to the matching heading on every connected
student card. Headings are tagged server-side via injectHeadingIds
so the client doesn't need a second roundtrip.
```

Keep the first line ≤72 chars. The body is optional but encouraged for anything non-trivial.

Use a HEREDOC for multi-line messages so formatting survives:

```powershell
git commit -m "$(cat <<'EOF'
feat: jump preview to selected question heading

When a teacher picks a question in the Live Monitor selection bar,
DocPreview now scrolls to the matching heading on every connected
student card.
EOF
)"
```

### 5c. Verify the commit

```powershell
git log -1                          # confirm message + author
git show --stat HEAD                # confirm file list
```

If the commit is wrong, fix it with `git commit --amend` (only safe before push).

---

## Step 6 — Merge your branch into `main`

**Never rebase. Never force-push. Never touch `main`'s history.** The merge is a single `--no-ff` (or fast-forward when possible) into `main`. Your branch's commits are preserved as-written.

You're running inside your worktree; `main` is checked out in `<main-path>` (from Step 0). Drive the merge with `git -C <main-path>` so you don't have to leave your worktree. Replace `<main-path>` with the actual path (typically `..\Panopticon`) and `<feature-branch>` with yours.

### 6a. Sync the main checkout with origin

```powershell
git -C <main-path> fetch origin
git -C <main-path> switch main
git -C <main-path> pull --ff-only
```

If `pull --ff-only` fails — meaning local `main` has commits that origin doesn't — stop and ask the user. Don't try to reconcile yourself.

### 6b. Try a fast-forward merge first

```powershell
git -C <main-path> merge --ff-only <feature-branch>
```

If this succeeds, your branch tip is now `main`'s tip — done, go to Step 6d.

### 6c. Fast-forward refused → fall back to a `--no-ff` merge

`--ff-only` fails when `main` has commits your branch doesn't. That's the expected case if another agent shipped while you were working. Make a merge commit:

```powershell
git -C <main-path> merge --no-ff <feature-branch>
```

This creates one new commit on `main` with two parents (the old `main` tip + your branch tip). Your branch's commits are preserved verbatim:

```text
A — B — C  (main, before)             A — B — C ───── M  (main, after)
     \                                     \         /
      D — E  (your branch)                  D — E ──┘
```

**If the merge completes cleanly** (no `CONFLICT` markers in the output), go to Step 6d.

**If the merge surfaces conflicts**, you resolve them yourself with best-guess judgement, then verify the result is sound. Don't escalate just because there's a conflict — most are mechanical.

```powershell
# See which files are conflicted.
git -C <main-path> diff --name-only --diff-filter=U
```

For each conflicted file:

1. Open it in `<main-path>` (or read it via the file tool).
2. Look at both sides of every `<<<<<<<` / `=======` / `>>>>>>>` block.
3. Resolve in the way that preserves the intent of both branches. If both sides edited the same field for different reasons, combine them. If one side moved a function the other modified, apply the modification at the new location. If you're truly unsure of intent, leave that block alone and flag it in the escalation message below.
4. Stage the file: `git -C <main-path> add <file>`.

After every conflicted file is staged, finalise the merge:

```powershell
git -C <main-path> commit --no-edit
```

### 6d. Verify the merge result is sound

Whether the merge was fast-forward, clean `--no-ff`, or conflict-resolved, run the full suite **in the main checkout** before going further:

```powershell
cd <main-path>
npm run typecheck
npm test
```

**If both pass** — proceed to Step 7. The merge is sound.

**If either fails** — you need a decision from the user.

```powershell
# Roll the merge back to the pre-merge state.
git -C <main-path> reset --hard HEAD~1   # safe: nothing has been pushed yet
```

Then stop and report:

- Which files conflicted (if any) and how you resolved each block.
- Which test(s) or typecheck errors surfaced.
- Your best guess at the cause (e.g. "the conflict resolution on `routes.ts` preserved both endpoints but the new helper signature changed").
- Ask the user whether to retry with a different resolution, abandon the merge for now, or some other option.

Once they decide, restart from 6c with the new resolution. Don't push until tests are green on `main`.

> Squash merges (`--squash`) are off by default for the same reason rebasing is: they discard commit-level history. If the user explicitly wants a single landing commit, they'll ask.

---

## Step 7 — Push

```powershell
git -C <main-path> push origin main
```

This is the step the user is least able to undo. Before running it, confirm:

- `npm run typecheck` and `npm test` are **green on `main` after the merge** (Step 6d).
- `git -C <main-path> log --oneline -5` looks right (your merge commit, or your branch tip if fast-forwarded, sits on top).
- You're pushing to `origin/main`, not anywhere unexpected (`git -C <main-path> remote -v` if unsure).

**Never** `--force` push to `main`. If a push is rejected:

```text
! [rejected]        main -> main (fetch first)
```

That means another agent pushed to `origin/main` between your `git pull --ff-only` (Step 6a) and this push. Stop and tell the user. The fix is to redo Steps 6a–6d to absorb the new work via a fresh `--no-ff` merge, then push again. Don't rebase. Don't force-push.

---

## Step 8 — Clean up the worktree and the branch

After a successful push, tear down your sandbox. **Worktree first, branch second** — `git branch -d` refuses if the branch is still checked out anywhere.

### 8a. Remove the worktree

You're currently inside the worktree, so you need to move out before running the removal. The simplest path is to drive the cleanup from the main checkout with absolute or relative paths:

```powershell
# From inside the worktree, run this against the main checkout. Replace
# ..\Panopticon-<purpose> with the actual worktree path; you can find it
# in the output of `git worktree list`.
git -C <main-path> worktree remove ..\Panopticon-<purpose>
```

If `git worktree remove` complains about untracked files in the worktree, decide whether those are leftovers worth keeping (rare — you should've committed or discarded everything by Step 5). If so, copy them out first; otherwise `git -C <main-path> worktree remove --force ..\Panopticon-<purpose>`.

After removal, your shell's current directory is gone. Your next command must `cd <main-path>` or use `git -C <main-path>` for subsequent steps. Cursor will probably also lose its working directory binding — that's expected; the session is wrapping up anyway.

### 8b. Delete the branch

```powershell
git -C <main-path> branch -d <feature-branch>              # local delete (refuses if unmerged — that's a safety net)
git -C <main-path> push origin --delete <feature-branch>   # only if the branch existed on the remote
```

Skip the remote delete if the branch was local-only.

---

## Step 9 — Final report

End the session with a short status to the user:

- Summary of what shipped (1-3 lines).
- Branch + commit hash that landed.
- Test counts: e.g. "33 tests pass, typecheck clean".
- Anything you noticed during cleanup that's **not** part of this feature but might be worth a follow-up (don't fix it now — note it so the user can decide).
- Anything the user should manually verify in the browser (the recipe from the feature doc).

---

## Anti-patterns

- **Rebasing your branch onto `main`.** The `--no-ff` merge-commit fallback in Step 6c exists specifically so you never have to. Rebase rewrites your branch's commits (new SHAs), breaks any reference that points at them, and forces a re-test. Merge commits are strictly additive.
- **Pulling `main` into your branch before the merge.** Your branch is supposed to be frozen at its start commit (see [`new-agent.md`](./new-agent.md) Step 2). Reconciliation happens in Step 6 of *this* doc, not by you mid-session.
- **Escalating on the first conflict marker.** Most `--no-ff` conflicts are mechanical — resolve them with best-guess judgement, run the tests, and only escalate if tests go red or you genuinely can't infer intent.
- **Skipping tests with `.skip` / `.todo` to make CI green.** Fix or delete instead.
- **`git add .` or `git add -A` without inspecting `git status` first.** That's how `config.yaml` and `data/panopticon.db` end up in commits — or another agent's uncommitted work-in-progress from a shared working tree.
- **Squashing commits without the user asking.** History is cheap; rewriting it is annoying.
- **Force-pushing main.** Never.
- **Editing the commit message after push.** It requires force-push. Don't.
- **Merging your own changes into someone else's branch.** Each agent owns its own branch end-to-end.
- **Pushing while tests are running in another window.** Wait for the run to finish.
- **Updating dependencies as part of a feature commit.** Dep bumps belong in their own `chore:` commit.
- **Deleting the branch before removing the worktree.** Order matters — `git branch -d` refuses while a worktree holds the branch.

---

## Quick-reference: the full sequence

You're running inside your worktree. `<main-path>` is the path to the main checkout (from `git worktree list`, typically `..\Panopticon`); `<branch>` is your feature branch. **Never rebase. Never force-push.**

```powershell
# 0. Sanity check (you are in a worktree, on a feature branch, tree clean)
git status; git log --oneline -5; git branch --show-current; git worktree list

# 1. Tests
npm run typecheck
npm test

# 2. Clean up debug code, then re-run if it became a refactor:
# (edit files)
npm run typecheck; npm test

# 3. Update docs
# (edit docs)

# 4. Self-review
git diff main...HEAD
git status

# 5. Commit
git add <files>
git commit -m "..."

# 6. Merge into main (drive from the worktree via -C; ff if possible, --no-ff otherwise)
git -C <main-path> fetch origin
git -C <main-path> switch main
git -C <main-path> pull --ff-only
git -C <main-path> merge --ff-only <branch>   # if this fails because main moved:
git -C <main-path> merge --no-ff  <branch>    # resolve any conflicts, then commit --no-edit

# 6d. Verify the merge result on main
cd <main-path>; npm run typecheck; npm test   # if either fails: reset --hard HEAD~1 and ask the user

# 7. Push
git -C <main-path> push origin main

# 8. Cleanup (worktree first, then branch)
git -C <main-path> worktree remove ..\Panopticon-<purpose>
git -C <main-path> branch -d <branch>
git -C <main-path> push origin --delete <branch>   # only if it was pushed
```
