Structured session todo list. **Tasks are verbatim content strings, NEVER generated ids — no `task-1`/`task-N`. Pass the content in `task`.**

After a state-changing op the earliest `pending` task in phase order auto-promotes if nothing is `in_progress`; if several are, only the earliest stays. Blocked tasks NEVER auto-promote; completed tasks NEVER revert.

## Operations

- `init` — `list: [{phase, items: string[]}]` initializes and replaces; bare `items: string[]` is a flattened single-phase init.
- `start` · `done` · `drop` — `task` or (for the last two) `phase`: in progress / completed / abandoned.
- `block` `task`|`phase` + optional `reason` — awaiting external input; skips the stop-time reminder. `unblock` → `pending`.
- `append` `phase` + `items: string[]` — appends, creating the phase lazily.
- `rm` optional `task`|`phase` — omit both to clear. `view` — read-only echo.

## Rules

- Task content: 5–10 words, what not how, unique. Phase: short noun phrase (`Foundation`, `Auth`), unique, NEVER prefixed `1.` / `A)` / `Phase 1:`.
- Mark done immediately; complete phases in order.
- NEVER make a todo call the turn's only tool call. Batch with real work: `init` with the first reads or edits, each `done`/`start` with the next action.
- Waiting on something you cannot act on — a user decision, another agent, a service — `block` it; `in_progress` moves to the next `pending` task, never back. If an agent could clear the blocker, `append` an unblocking task instead.
- Keep `task`/`phase` strings stable. Lost the exact text? `view` echoes the list — NEVER guess from memory.
- Create a list when the work has 3+ distinct steps, the user asks or supplies a set of tasks, or new instructions arrive mid-task.

{{critical}}

{{examples}}
