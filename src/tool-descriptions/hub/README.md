# hub

6479 → ~2040, the largest cut here and the tightest budget. `hub.md` carries no
Handlebars conditionals at all, so the prose is byte-identical for every session
on a given OMP version and only the appended `<examples>` block varies.

## Slots

- `examples` — pi's generated block (~1600 characters live). Elastic, and in
  practice always trimmed to nothing: `hub` is two tools in one envelope and the
  operation vocabulary has to come first.

## Deliberate losses

`hub` documents peer messaging *and* project-scoped process supervision. Both
halves survive, but the process half is cut hardest, because its parameters are
discoverable from the schema while the messaging half is almost entirely
behavioural rules the schema cannot express.

- `list`'s `limit` defaults (32, max 100) and the parked-roster explanation. The
  rule that survives is the one that matters: address peers by exact roster id,
  never an invented one.
- `logs`' 100-line default, `head`, and the `keys`/`signal` enumerations.
- `restart` / `persist` / `detached` policy.
- The `wait`-returns list is kept in full. It is the one place the tool's
  behaviour contradicts the obvious reading — it returns on the FIRST wake
  reason, not when all jobs finish — and a model that gets this wrong polls in a
  loop.

## Headroom

~11 characters. That is fine for a fixed OMP version and by design elsewhere: if
`hub.md` grows, no variant fits, the bridge forwards the original and warns that
this profile needs re-authoring. See the parent README on why a stale
condensation is the failure worth being loud about.
