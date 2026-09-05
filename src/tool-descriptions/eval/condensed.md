Run one step of code in a persistent kernel. State persists across calls and `task` subagents.

Work incrementally — imports → define → test → use, each its own cell. Re-run setup ONLY after `reset` or a kernel crash. On error, fix and re-run just the failing step. Long cells may auto-background and deliver later; `timeout: 0` disables the cell deadline.

{{prelude}}

{{critical}}
