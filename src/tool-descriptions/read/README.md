# read

2928 → ~2000. One variant; OMP renders `read`'s description from
`prompts/tools/read.md` with a single conditional, so there is only one document
here and the mode difference is carried by a slot.

## Slots

- `hashline` — the `[foo.ts#1A2B]` bullet, which OMP emits only in hashline mode.
  Lifted from the live text so the condensation never claims a snapshot header
  the session will not print. Elastic: if the budget runs out this bullet goes
  first, because losing it costs less than falling back to a truncated original.
- `critical` — the closing `<critical>` block, verbatim. This is the whole point
  of condensing `read`: at 2928 characters the block sits 880 past Claude Code's
  cut, so the rule against inventing content for elided ranges never reached the
  model at all.

## Deliberate losses

- Full archive-extension list, trimmed to the common ones plus "more". Trying an
  unlisted extension costs one failed call; the list costs 90 characters.
- `attachment://N?q=` and `local://…?q=` named as image `?q=` targets. The
  generic `?q=` rule survives and covers them.
- `<instruction>` and `<critical>` tags around the two SHOULD bullets, folded
  into the opening sentence.
