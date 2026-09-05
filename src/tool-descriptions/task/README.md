# task

4302 → ~1880. `task.md` is the most conditional template OMP ships — thirteen
`{{#if}}` branches over async, batching, isolation, effort, IRC and eval tools —
so the shipped variant pins the shape this repo can verify.

## Slots

- `agents` — `# Available Agents` and the `### <name>` roster beneath it,
  lifted verbatim. **This is why the profile splices rather than freezes.** The
  roster is per-project: it names your custom agents, marks which are read-only
  and which block, and the model cannot pass an `agent` it was never told about.
  Elastic, trimmed one whole `### <name>` entry at a time so a surviving agent
  always keeps its description.

## Variants

Only `async-batch` — async delivery *and* `tasks[]` batching, which is OMP's
default for a model that supports it. A synchronous or single-task session
matches nothing, so the bridge forwards the original and says so rather than
describing a batch API that session does not have.

## Deliberate losses

- The `# Async Job Contract` section, cut to the three facts that change what
  the model does: results auto-deliver, ids expire ~5 min after settlement, and
  `completed` means exited, not correct. The `outputSchema`/`agent://<id>?q=`
  serving rules went; the fields themselves are still named under Inputs.
- `# Communication` and `# Format Contracts` folded into two bullets. The
  `# Target` / `# Change` / `# Acceptance` skeleton is kept verbatim — it is the
  difference between a task another agent can execute and one it has to guess at.
- Per-field prose for `tools`, `effort`, `outputSchema` and `schemaMode`, reduced
  to the field names. Their values are in the schema; their existence is not.
