# eval

8442 → ~1940. The worst case in the set: the model currently sees roughly the
first quarter of this description, so if you have ever watched it misuse `eval`'s
options, this is why.

## Slots

- `prelude` — the `<prelude>` block: the kernel API, which OMP renders for the
  languages and features this session enabled (`py`, `js`, `spawns`,
  `evalTools`). Freezing it would document an API that is not there. Elastic and
  always trimmed, since the block alone is ~2200 characters against a 2048
  budget — entries are packed greedily, so a dozen one-line signatures are not
  lost behind the ~900-character `agent()` entry that precedes them.
- `critical` — verbatim, and the whole reason this profile exists: *prior
  top-level names survive into the next cell — reuse, NEVER re-import*. It is the
  last thing in the description and has never once reached the model.

## Variants

- `code-mode` — Codex Code Mode, where `eval` is the primary work surface and the
  direct tool surface is restricted. Matched first.
- `default` — everything else.

## What the live capture changed

The reference `original.md` here is a real capture, not a reconstruction, and it
is 8442 characters — twice what OMP's `eval.md` renders on its own. The extra is
`preludeDocumentation`: a whole documentation section injected mid-description
for whatever prelude the session has loaded (the `browser` prelude, on the
machine this was captured from), carrying its own `<instruction>`, `<examples>`
and `<critical>` blocks.

That is why the block extractors take the LAST match. Taking the first spliced
the browser prelude's `<critical>` into `eval`'s description in place of its own
rule, which is the failure this module exists to prevent — documentation that is
confidently about the wrong thing rather than visibly incomplete. Caught only by
running against a live session; every reference fixture had a single block.

The injected prelude documentation itself is dropped whole: at ~3900 characters
it cannot fit, and unlike the kernel API it documents an object (`browser`) whose
own methods the model discovers by calling it.

## Deliberate losses

- The `<dag>` block, on how to wire acyclic waves of agent handles. Real content,
  but it is technique rather than contract, and it costs ~500 characters.
- The generated `declare const tool: { … }` TypeScript block in code mode
  (~1000 characters and growing with the tool count). Through this bridge every
  pi tool is *already* advertised to Claude Code as an MCP tool with its own
  schema, so these declarations are the one thing here the model can read
  somewhere else.
- The Python/JS split notes and the auto-background threshold prose, compressed
  to a clause each.
