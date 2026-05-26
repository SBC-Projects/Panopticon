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
```

Confirm:

- You are on a **feature branch**, not `main`. If you're on `main`, stop and ask the user how to proceed.
- `git status` is what you expect (your work is present; nothing weird is untracked).
- The latest commit on this branch is your work, not someone else's.

If the working tree has unrelated dirty files (anything you didn't write this session), **stop and ask the user** before continuing.

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

## Step 6 — Merge to `main`

Default strategy: **fast-forward merge** (`--ff-only`). This keeps `main`'s history linear and only succeeds if the branch is rebased on top of `main`.

```powershell
# Make sure main is up to date with origin.
git fetch origin
git switch main
git pull --ff-only

# Try the fast-forward merge.
git merge --ff-only <feature-branch>
```

If `--ff-only` fails because `main` has commits your branch doesn't have:

```powershell
git switch <feature-branch>
git rebase main
# Resolve any conflicts in your editor, then:
npm run typecheck
npm test
# If still green:
git switch main
git merge --ff-only <feature-branch>
```

If conflicts during rebase are non-trivial, **stop and report to the user** — don't guess at intent.

> Use a merge commit (`git merge --no-ff <branch>`) instead of fast-forward only when the user explicitly asks for one (e.g. they want a visible "feature branch" arc in the log).

---

## Step 7 — Push

```powershell
git push origin main
```

This is the step the user is least able to undo. Before running it, confirm:

- `npm test` and `npm run typecheck` are **still** green after the merge (rebases can break things).
- `git log --oneline -5` looks right.
- You're pushing to `origin/main`, not anywhere unexpected (`git remote -v` if unsure).

**Never** `--force` push to `main`. If a push is rejected:

```text
! [rejected]        main -> main (fetch first)
```

Stop, run `git fetch`, see what's on `origin/main` that you don't have, and ask the user how to proceed. Almost always the answer is "rebase and try again", but ask before assuming.

---

## Step 8 — Clean up the branch

After a successful push:

```powershell
git branch -d <feature-branch>          # local delete (refuses if unmerged)
git push origin --delete <feature-branch>   # only if the branch existed on the remote
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

- **Skipping tests with `.skip` / `.todo` to make CI green.** Fix or delete instead.
- **`git add .` or `git add -A` without inspecting `git status` first.** That's how `config.yaml` and `data/panopticon.db` end up in commits.
- **Squashing commits without the user asking.** History is cheap; rewriting it is annoying.
- **Force-pushing main.** Never.
- **Editing the commit message after push.** It requires force-push. Don't.
- **Merging your own changes into someone else's branch.** This is a solo repo for now; if it stops being solo, the rules change.
- **Pushing while tests are running in another window.** Wait for the run to finish.
- **Updating dependencies as part of a feature commit.** Dep bumps belong in their own `chore:` commit.

---

## Quick-reference: the full sequence

```powershell
# 0. Sanity check
git status; git log --oneline -5; git branch --show-current

# 1. Tests
npm run typecheck
npm test

# 2. Clean up debug code, then re-run if it became a refactor:
# (edit files)
npm run typecheck && npm test

# 3. Update docs
# (edit docs)

# 4. Self-review
git diff main...HEAD
git status

# 5. Commit
git add <files>
git commit -m "..."

# 6. Merge (fast-forward)
git fetch origin
git switch main
git pull --ff-only
git merge --ff-only <branch>

# 7. Push
git push origin main

# 8. Cleanup
git branch -d <branch>
```
