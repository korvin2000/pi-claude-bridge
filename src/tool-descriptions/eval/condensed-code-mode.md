Run one step of code in a persistent kernel. State persists across calls and `task` subagents.

Code Mode is active: this tool is your primary work surface and the direct tool surface is restricted. Plan several operations into ONE cell whenever the next steps are known, calling session tools as `await tool.<name>(args)` — spawn independent calls without awaiting, then `await Promise.all([…])`. Prefer `tool.*` over raw `Bun.file`/fs so work flows through the session pipeline. Reserve a separate cell for any step that must inspect an earlier result.

Work incrementally; re-run setup ONLY after `reset` or a kernel crash. On error, fix and re-run just the failing step.

{{prelude}}

{{critical}}
