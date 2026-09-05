# Tool descriptions

Claude Code truncates every MCP tool description at **2048 characters** when it
renders the tool into the model prompt. The cap is a lexical constant in the
binary, there is no override, and it happens silently — the model sees a tool
whose documentation stops mid-sentence and has no way to know anything is
missing.

Oh My Pi's built-in tools are well past it:

| tool | live length | condensed | what truncation was destroying |
| --- | --- | --- | --- |
| `eval` | 8442 | ~1940 | the `<critical>` rule that top-level names survive into the next cell |
| `hub` | 6479 | ~2040 | the entire `# Processes` half |
| `edit` (hashline) | 5235 | ~2040 | `<rules>`, the examples, and `RE-GROUND AFTER EVERY EDIT` |
| `task` | 4302 | ~1880 | `# Available Agents` — the roster the model picks from |
| `todo` | 3551 | ~2030 | the rule against summarizing a user's plan into fewer tasks |
| `read` | 2928 | ~2000 | the rule against inventing content for elided ranges |

The pattern is the point. A description's head is its core contract, so what a
cap destroys is the tail — and OMP, sensibly, puts its sharpest rules last. Every
one of those `<critical>` blocks is past the cut today.

So the bridge substitutes prose written to fit. This directory holds one folder
per tool: what the live description looks like, what replaces it, and why.

## Layout

```
<tool>/
  profile.json        matching rules, slots, budget order
  condensed*.md       the replacement template, one per variant
  original*.md        the description it was written against
  README.md           what was cut and why
```

`profile.json`:

```json
{
  "tool": "task",
  "slots": { "agents": { "from": "section", "heading": "# Available Agents" } },
  "elastic": ["agents"],
  "variants": [{
    "id": "async-batch",
    "requires": ["# Async Job Contract", "`tasks[]` batch"],
    "verifiedLength": 4302,
    "template": "condensed-async-batch.md",
    "original": "original.md"
  }]
}
```

- **`variants`** are tried in order; the first whose `requires` strings all
  appear in the live description wins. Order expresses absence: `read`'s hashline
  variant is listed before the plain one, so "no hashline marker" selects the
  plain one without any way to write "NOT".
- **`requires`** is the verification. If nothing matches, the bridge forwards the
  original — truncated, but honest — and warns. **A stale condensation is worse
  than a truncation**: truncation is visibly incomplete, wrong documentation is
  not. That asymmetry is the reason this whole mechanism is opt-out rather than
  clever.
- **`verifiedLength`** is advisory. OMP's own conditionals move these lengths per
  session, so a large deviation is logged as "worth re-reading", never as a
  failure.
- **`slots`** name `{{placeholders}}` in the template and say where to lift them
  from the **live** text. An absent span renders empty, so a template never has
  to ask whether this session enabled the feature the span documents.
- **`elastic`** lists the slots that may be trimmed to fit, in the order they
  should be *spent*: the last one listed is cut first. Put the most valuable slot
  first.

### Slot sources

| `from` | selects | trimmed by |
| --- | --- | --- |
| `examples` | the `<examples>` block pi appends from a tool's structured examples | one `<example>` at a time |
| `block` | `<tag>…</tag>` — `<prelude>`, `<critical>` | one signature (plus its indented explanation) at a time, else by line |
| `section` | a markdown heading and everything under it, to the next heading of the same or higher level | one `### sub-entry` at a time, else by line |
| `line` | the first line containing a substring | dropped whole |

Entry-shaped spans are packed greedily rather than kept as a prefix: `eval`'s
prelude leads with a 900-character `agent()` block that would otherwise cost
every one-line signature behind it. Prose spans keep a prefix, because a
paragraph with a hole in it is worse than one that stops. Either way a trimmed
span carries a visible `… N more, trimmed to fit` marker — a cut the reader
cannot see is exactly the failure this replaces.

## Why splice at all

OMP assembles descriptions at runtime: Handlebars templates in
`packages/coding-agent/src/prompts/tools/*.md` (and `crates/pi-edit/prompts/` for
`edit`, whose text comes out of a Rust addon), rendered against session state,
with pi appending an `<examples>` block afterwards. A frozen string would
therefore be wrong in the ways that matter most — `task` would not name *your*
project's agents, `eval` would list a kernel API for languages you have not
enabled, `read` would promise a hashline header a line-number session never
prints. Those spans are lifted from the live text and pasted in verbatim.

## Authoring a profile

1. **Capture what your session actually renders.** Set
   `"toolDescriptions": { "capture": true }` in `claude-bridge.json`, run one
   turn, and read `<agent dir>/claude-bridge-tool-descriptions/<tool>.md`. Do not
   author against OMP's source markdown — it is a template, never the text the
   model sees.
2. Copy that capture in as `original.md` and write `profile.json` around it.
3. Write `condensed.md`. OMP's own `omp compress` command and its
   `semantic-compression` skill are the house style, and they are worth reading
   before starting: re-encode each claim into a telegraphic register rather than
   deleting words, and never drop a normative modal (MUST, NEVER), a negation, or
   a number.
4. `node diag/check-tool-descriptions.mjs` prints the budget table for every
   variant. Iterate until it fits with headroom.
5. `npm run test:unit -- tests/unit-tool-descriptions.mjs` enforces the
   invariants, including that the static prose fits with every slot empty.

To change a condensation without forking, point
`toolDescriptions.overridesDir` at a directory of the same shape. It takes
precedence per tool, so overriding `eval` leaves everything else shipped.

## Deliberately not profiled

- **`edit` in `sloppy` mode** (5827) and **`replace`** mode. `replace` is 1134
  and never truncated. `sloppy` is an opt-in mode this repo cannot exercise, and
  a dense grammar spec is the worst place to guess: a wrong condensation there
  costs failed edits, not just lost nuance.
- **`computer`** (4758) and **`browser`** (4029), which are over the cap but only
  present when those tools are enabled. They are reported by the size warning,
  not silently ignored.

## What this deliberately does not do

Move prose into the system prompt. It is the obvious other way to beat a
per-tool cap, and it is a bad trade here: the bridge rebuilds the system prompt
every turn, and byte-stability of that prefix is what keeps the prompt cache
warm. Per-tool text in the cached prefix costs more than truncation ever did.

For the same reason nothing here runs a model or generates text at startup. A
description that varied between sessions would break the cache on every turn.
Every condensation in this directory is a file on disk, written once, by hand.
