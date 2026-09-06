Structural AST-aware rewrites via ast-grep. Use for codemods where text replace is unsafe. Mixed-language paths are fine: each file is parsed in its own language, and a pattern only rewrites files it parses in.

- Metavariables in `pat` (`$A`, `$$$ARGS`) substitute into `out`.
- **Patterns match AST structure, not text.** `$NAME` = one node; `$_` = unbound; `$$$NAME` = zero-or-more.
  - Use `$$$NAME`, NOT `$$NAME` (invalid). Names UPPERCASE, whole node — partial like `prefix$VAR` fails.
- Same metavariable twice → MUST match identical code (`$A == $A` matches `x == x`, not `x == y`).
- Rewrite patterns MUST parse as single AST node. Non-standalone → wrap: `class $_ { … }`.
- TS: tolerate annotations — `async function $NAME($$$ARGS): $_ { $$$BODY }`. Delete with empty `out`: `{"pat":"console.log($$$)","out":""}`.
- 1:1 substitution — no splitting/merging captures.
- Matches are STAGED as a proposal, not applied: finalize by writing a one-sentence reason to `xd://resolve` (apply) or `xd://reject` (discard).
- Parse issues → malformed rewrite, not clean no-op. For one-off text edits, prefer the Edit tool.

<examples>
# Rename a call site across TypeScript files
<example>
ast_edit(i="…", ops=[{"pat": "oldApi($$$ARGS)", "out": "newApi($$$ARGS)"}], paths=["src/**/*.ts"])
</example>
# Delete matching calls
<example>
ast_edit(i="…", ops=[{"pat": "console.log($$$ARGS)", "out": ""}], paths=["src/**/*.ts"])
</example>
# Rewrite import source path
<example>
ast_edit(i="…", ops=[{"pat": "import { $$$IMPORTS } from \"old-package\"", "out": "import { $$$IMPORTS } from \"new-package\""}], paths=["src/**/*.ts"])
</example>
# Modernize to optional chaining (same metavariable enforces identity)
<example>
ast_edit(i="…", ops=[{"pat": "$A && $A()", "out": "$A?.()"}], paths=["src/**/*.ts"])
</example>
# Swap two arguments using captures
<example>
ast_edit(i="…", ops=[{"pat": "assertEqual($A, $B)", "out": "assertEqual($B, $A)"}], paths=["tests/**/*.ts"])
</example>
# Python — convert print calls to logging
<example>
ast_edit(i="…", ops=[{"pat": "print($$$ARGS)", "out": "logger.info($$$ARGS)"}], paths=["src/**/*.py"])
</example>
</examples>