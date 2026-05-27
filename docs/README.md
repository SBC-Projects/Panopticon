# Panopticon — Docs Index

This folder is the source of truth for **AI coding agents** working on Panopticon. Read the relevant doc(s) **before** writing code. Keep docs updated when behaviour changes.

End-users looking for setup/usage instructions: see [`how-to-use.md`](./how-to-use.md) (or the root [`README.md`](../README.md) for the short version).

---

## How agents should use this folder

1. **Always read first**: [`conventions.md`](./conventions.md). It's short and contains the hard rules.
2. **Starting a new feature or fix** (triggered by `/new-agent`): follow [`new-agent.md`](./new-agent.md) end-to-end.
3. **Wrapping up — testing, cleanup, commit, merge, push** (triggered by `/end-agent`): follow [`end-agent.md`](./end-agent.md) end-to-end.
4. **For everything else**: use the routing table below to read **only the docs you need**. Don't read everything — pick the ones that touch your task.

---

## Routing table

### By task type

| If you are… | Read |
|-------------|------|
| Onboarding as a new agent on any task | [`new-agent.md`](./new-agent.md), [`conventions.md`](./conventions.md), [`architecture.md`](./architecture.md) |
| Wrapping up: testing, cleanup, commit, merge, push | [`end-agent.md`](./end-agent.md) |
| Adding or changing an HTTP/SSE endpoint | [`reference/api.md`](./reference/api.md), then the feature doc that owns it |
| Touching the database schema or `Submission` type | [`reference/data-model.md`](./reference/data-model.md), [`conventions.md`](./conventions.md) |
| Confused by a term (class, assignment, kind, watch root) | [`reference/glossary.md`](./reference/glossary.md) |
| Trying to run, debug, or inspect the app | [`workflows/debugging.md`](./workflows/debugging.md) |
| Writing a test or verification recipe | [`workflows/testing.md`](./workflows/testing.md) |
| Authoring a new feature design doc | [`features/_template.md`](./features/_template.md) |

### By feature area

| Feature surface | Doc |
|-----------------|-----|
| Assignment-centric live monitor view (Class → Assignment → wall of student cards + metrics, SSE-driven) | [`features/live-monitor.md`](./features/live-monitor.md) |
| `.pptx` support: word count + excerpt + slide-title dropdown + PowerPoint COM per-slide image rendering | [`features/powerpoint-support.md`](./features/powerpoint-support.md) |

> When a new feature ships, **add a row here** and a new file under [`features/`](./features) using [`features/_template.md`](./features/_template.md). That's how the routing scales.

### Reference (lookup, not narrative)

| Doc | What it answers |
|-----|-----------------|
| [`reference/api.md`](./reference/api.md) | "What's the endpoint / shape for X?" |
| [`reference/data-model.md`](./reference/data-model.md) | "What columns / types / invariants exist?" |
| [`reference/glossary.md`](./reference/glossary.md) | "What does this term mean here specifically?" |

---

## When you finish a task

- Update the feature doc (or create one) so it reflects what shipped, including deviations from the original plan.
- If the API or data model changed, update the relevant reference doc.
- Add a row to the routing table above if you introduced a new feature doc.
- Run `npm run typecheck` before declaring done.
- **Never commit unless the user explicitly asks.**
