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
  original*.md        the live description it was written against
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
| `line` | a line containing a substring | dropped whole |

All four take the **last** match. A description can carry more than one block
with the same tag — injected prelude documentation lands in the middle, and pi
appends its `<examples>` after everything — so the tool's own block is the later
one.

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

Every `original.md` here is a real capture from a live Oh My Pi session, not a
re-render of OMP's source markdown. That distinction is not pedantic: the first
live capture put `eval` at 8442 characters against 4187 for the same template
rendered standalone, because a session injects `preludeDocumentation`
mid-description — and that injected section brings its own `<critical>` block.
Extracting the first match spliced the browser prelude's rule into `eval` in
place of its own. Hence the extraction rule above, and hence step 1.

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

## Surviving an Oh My Pi upgrade

OMP ships often, and its tool descriptions move with it. One upgrade landed
mid-development and is the evidence this section rests on: `eval` went 8442 →
13443 (a second prelude's documentation was injected), `edit` in patch mode 2750
→ 3376, `task` 4302 → 4486, and `read`/`hub`/`todo` did not move at all. **No
profile broke.** What needed work was only what had never existed: a `sloppy`
variant, and `ast_edit` crossing the cap for the first time.

Four things make that the normal outcome rather than luck:

1. **Matching is content-based, never version-based.** There is no version field
   anywhere here, and there should not be: a profile claims a description by
   markers in the text, so it keeps working until the thing it describes changes.
2. **`requires` and `expect` prefer API surface to prose.** A tag name, a field, a
   URL scheme, an operator — those change far less often than the sentences around
   them, and they are what a condensation is actually about.
3. **Dynamic spans are spliced, not frozen.** A version that adds an agent, a
   kernel function or a whole prelude changes the span, not the profile.
4. **Nothing fails into silence.** Variant mismatch, budget overflow and a slot
   that resolved to the wrong span all end in the same place: the shape-only
   fallback below, plus a warning naming the tool.

### The shape-only fallback

When no profile matches — a tool nobody wrote one for, or one this OMP version
outgrew — the bridge condenses by structure instead, knowing no OMP vocabulary at
all. It keeps the lede and the tool's own closing `<critical>`, drops example
blocks outright, packs the remaining sections in document order, and marks what it
dropped. It never rewrites and never invents: every line it emits is a line from
the original.

Measured against the live captures, it lands within a few hundred characters of
the hand-written profiles by volume, and preserves the `<critical>` block in every
case where truncation destroyed it:

| tool | live | shape-only | profile |
| --- | --- | --- | --- |
| `eval` | 13443 | 1996 | 1944 |
| `hub` | 6479 | 2021 | 2047 |
| `edit` sloppy | 5827 | 2041 | 1868 |
| `task` | 4486 | 2044 | 1999 |
| `read` | 2928 | 1790 | 1995 |

It is still worse than a profile, and the gap does not show up in that table: a
profile re-encodes its prose, so its 2000 characters carry more than the
fallback's 2000 uncompressed ones, and it chooses what to keep by meaning rather
than by position. Treat the fallback as the floor, not the goal. `fallback: false`
turns it off and restores plain truncation.

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
