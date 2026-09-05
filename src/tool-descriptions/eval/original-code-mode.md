Run one step of code in a persistent kernel. State persists across calls and `task` subagents.
Eval `agent()` children use independent kernels.

Work incrementally: imports → define → test → use, each its own cell. Re-run setup ONLY after `reset`, kernel crash.
Two or more independent items → named `workpool()` + `.push(…)`; poll outside eval with `hub wait` on the pool name. Handles + `wait()` are for dependency-coupled results.

Top-level `await` works; `asyncio.run(…)` raises error.
JS runs under **Bun**: globals (`Bun.file`, `Bun.write`, `Bun.$`, `fetch`, `Buffer`) available; top-level `await`/`return` work.

On error, fix and re-run only the failing step.

<prelude>
Python: sync, kwargs. JS: async, ONE trailing object literal, never positional.
```
display(value) → None        print(value, ...) → None
read(path, offset?=1, limit?=None) → str
write(path, content) → str
env(key?=None, value?=None) → str | None | dict
output(*ids, format?="raw", query?=None, offset?=None, limit?=None) → str | dict | list[dict]
await tool.<name>(args) → unknown
    Invoke any session tool; `args` = its parameter object. Async: `await tool.read({...})`.
completion(prompt, model?="default"|"smol"|"slow", system?=None, schema?=None) → CompletionHandle
    Oneshot, stateless (no history/tools); returns immediately. `.wait()` → str (parsed object with `schema`). `model`: "smol" fast | "default" session | "slow" most capable.
agent(prompt, agent?="general", label?=None, schema?=None, schemaMode?="permissive", isolated?=None, apply?=None, merge?=None, tools?=None) → AgentHandle
    Spawns a background subagent and returns immediately. `agent` selects a discovered agent; omit it to use `general`. Handle: `.id`, `.handle` ("agent://<id>"), `.status`, `.done()`, `.wait(timeout?)` → final text (parsed with `schema`), `.send(message)`, `.cancel()`, `.output()`. Unwaited results auto-deliver like async jobs. `schema` overrides agent/session schemas; `isolated` requests a worktree; `apply`/`merge` control its changes. `tools`: names of your @tool-defined tools the child may call.
    JS: ONE trailing object — agent(prompt, { agent, label, schema, schemaMode, isolated, apply, merge, tools }).
wait(handles, timeout?=None, raise_errors?=True) → list
    Barrier over agent/completion handles, results in input order. `raise_errors=False` keeps the error in its slot. JS: wait(handles, { timeout, raiseErrors }).
workpool(agent?=None, name?=None, context?=None, tools?=None) → WorkPool
    Default for 2+ independent items. `.push(*items)`; `.status()`; `.peek()`; `.close()`. Pool name = async job id; results auto-deliver, or poll outside eval with `hub wait` and `ids:[pool.name]`. `eval.workpool.freshAgents=true` uses a new agent per item.
@tool / tool(fn, name=None, description=None)tool(fn, { name?, description?, parameters? })
    Define a tool that runs in this kernel (schema inferred from type hints); reference by name in `task` items' `tools`, `agent(tools=…)`, `workpool(tools=…)`. `tool.defined()`, `tool.undefine(name)`.
log(message) → None         phase(title) → None
budget → `budget.total` (ceiling or None), `budget.spent()`, `budget.remaining()``await budget.total()`, `await budget.spent()`, `await budget.remaining()`; ceiling `+Nk` advisory, `+Nk!` hard.
```
</prelude>
<dag>
Acyclic waves of handles:
- **Name nodes.** `h = agent(…)` returns at once; `h.handle` is `agent://<id>`.
- **Wire edges.** Put an upstream `.wait()` result or `.handle` in the downstream prompt. Bulk: `write("local://<name>.md", …)`.
- **`wait(hs)`** = wave barrier. Open-ended item streams → `workpool()`.
- **Isolate failure.** `wait(hs, raise_errors=False)` keeps a failure in its slot; only that subtree degrades.
- **Acyclic only.** No node waits on its own descendant.
</dag>

<critical>
Prior top-level names survive into the next cell — reuse; NEVER re-import/re-declare. Re-read only if file changed since last read.
</critical>

Long-running cells may auto-background by the configured threshold and deliver later; the kernel stays busy until the cell finishes.
`timeout: 0` disables the cell deadline; otherwise `timeout` sets it without extending foreground waiting.

Codex Code Mode is active: this tool is your primary work surface and the direct tool surface is restricted.
Plan multiple operations into ONE cell whenever the next steps are known, calling session tools via `await tool.<name>(args)`;
spawn independent calls without awaiting, then `await Promise.all([…])`. Prefer `tool.*` calls over raw `Bun.file`/fs so operations flow through the session tool pipeline.
Reserve separate cells for steps that must inspect earlier results.

exec tool declarations:
```ts
declare const tool: {
  read(args: { path: string; offset?: number; limit?: number }): Promise<string>;
  edit(args: { path: string; edits: unknown[] }): Promise<string>;
  bash(args: { command: string; timeout?: number }): Promise<string>;
  grep(args: { pattern: string; path?: string; glob?: string }): Promise<string>;
  glob(args: { pattern: string; path?: string }): Promise<string>;
  write(args: { path: string; content: string }): Promise<string>;
  todo(args: { op: string; task?: string; phase?: string }): Promise<string>;
  task(args: { context?: string; tasks: unknown[] }): Promise<string>;
  hub(args: { op: string; to?: string; text?: string }): Promise<string>;
};
```