# edit

The awkward one. `edit`'s description is not a document but five of them: OMP
picks one at runtime from `PI_EDIT_VARIANT` / the session's edit mode, and the
text comes out of the `pi-edit` Rust crate rather than the prompt markdown. Three
of the five are over the cap and profiled here; the variants are matched by
content, not by asking OMP which mode is on.

| mode | live | condensed |
| --- | --- | --- |
| `hashline` | 5235 | ~2040 |
| `patch` | 2750 | ~1810 |
| `apply_patch` | 2111 | ~1480 |
| `sloppy` | 5827 | not profiled |
| `replace` | 1134 | under the cap, never touched |

## Slots

- `critical` — the closing block, spliced verbatim, elastic as a last resort.
  In `hashline` it reduces to its first rule under budget pressure, and that is
  the right first rule to keep: *RE-GROUND AFTER EVERY EDIT — edits renumber and
  change `#TAG`.* Stale tags are the mode's dominant failure.

## Deliberate losses (hashline)

This is the profile that gives up the most, and it is worth being plain about
why: 5235 characters of dense patch grammar do not compress to 2048 without
choosing. What went:

- `<example>` — six worked examples, ~1050 characters. The largest single loss.
  The grammar in `<ops>` and `<body-rows>` is kept complete instead, on the
  reasoning that a model that knows the grammar can write the example.
- `<anti-patterns>` — six WRONG/RIGHT pairs, ~1050 characters. Their rules
  survive as prose in `<body-rows>` and `<rules>`.
- Three `<rules>` bullets whose content the spliced `<critical>` block restates.

Worth noting honestly: `hashline` is the one tool here where plain truncation was
not catastrophic. Cutting at 2048 happened to keep the intro, `<headers>`,
`<ops>` and `<body-rows>` — the parts a model needs most. The gain from
condensing is real but narrower than elsewhere: complete rules plus the
re-grounding rule, in place of `<rules>` stopping mid-sentence.

## Not profiled

`sloppy` (5827) is an opt-in mode this repo cannot exercise, and its description
is a grammar spec where a wrong condensation costs failed edits rather than lost
nuance. It matches no variant, so the bridge forwards the original and warns.
`replace` is 1134 characters and never reaches the cap.
