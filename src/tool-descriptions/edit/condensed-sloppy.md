Anchored edit format: quote current text in `<SM:FIND>`, state final text in `<SM:PUT>`, elide unchanged runs with `…`. Pairs live inside `<SM:EDIT>` and apply atomically.

<ops>
- Each `<SM:FIND>` MUST match exactly once; `<SM:EDIT path="x.ts" all>` applies its pairs to every match instead.
- `…` in `<SM:FIND>` elides text you do not restate: mid-line it stands between fragments on that line, at line end it spans lines. In `<SM:PUT>` it re-emits captured gaps in order, one per `<SM:FIND>` gap.
- `<SM:FIND>` MUST include a fragment of the CHANGED line — context alone can hit the wrong place. Keep pairs minimal: the smallest unique span plus the changed lines, and AVOID retyping unchanged ones.
- Repeated line? Include its unique parent branch in the same `<SM:FIND>`; NEVER retry the bare line.
- Pairs address the original file; earlier pairs never shift later anchors. "No change" means the file already reads as your `<SM:PUT>` — look elsewhere.
</ops>

{{critical}}
