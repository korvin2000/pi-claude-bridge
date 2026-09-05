# todo

3551 → ~2030. The live description is OMP's `prompts/tools/todo.md` (2599, no
conditionals) plus the ~950-character `<examples>` block pi appends from the
tool's structured examples.

## Slots

- `critical` — the closing block ordering the model to `init` every item of a
  user-supplied plan and never summarize it into fewer tasks. Elastic as a last
  resort only: falling back would lose the block entirely, since at 3551
  characters it sits well past Claude Code's cut, so trimming it line by line
  with a visible marker still beats the alternative.
- `examples` — pi's generated block, cut first. Eight worked calls do not fit a
  2048-character budget alongside the operation list, and the operation list is
  the part the model cannot guess.

## Deliberate losses

- The operations markdown table, re-encoded as a bullet run. Same fields, same
  effects, roughly 200 characters cheaper.
- The `Create a list` section, folded into one rule bullet.
- All eight examples, in the usual case. The `op` vocabulary and the field names
  survive in the operations list.
