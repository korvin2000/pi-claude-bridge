Delegate work to background subagents: several items in one `tasks[]` batch. Does not block — ids come back immediately. BLOCKING agents run inline and return in this call.

Results auto-deliver; a settled `hub jobs`/`hub wait` snapshot IS the delivery. Job ids expire ~5 min after settlement — then use `hub send` or `agent://<id>`. `completed` means the job exited, not that the work is right: verify claimed changes.

# Inputs

- `context` — state, constraints and contracts for the whole batch; never repeated per task.
- `tasks[]` — `name` (CamelCase ≤32 chars, generated if omitted) · `agent` · `task`, complete and self-contained: one-liners or missing acceptance criteria are PROHIBITED · `tools` · `effort` · `outputSchema` · `schemaMode` · `isolated` for a dedicated worktree.
- Subagents start blank. Pass large payloads as `local://<path>`, NEVER inline.
- `task` format: `# Target` files, symbols, explicit non-goals · `# Change` step-by-step, naming APIs and patterns · `# Acceptance` observable result, no project-wide commands.

# Task Design

- Pick each item's most specific available agent. Omit `agent` only when the spawn-policy default genuinely fits; NEVER pass that default explicitly.
- Each `task` MUST tell its agent to skip formatters, linters and project-wide test suites — validating mid-flight also blocks concurrent agents on each other's edits. Run them once, at the end.
- Parallelize independent ownership; same-file edits are not guaranteed to merge. Name one integration owner and settle cross-task contracts up front in `context`.

{{agents}}
