Line-anchored patch language: name original lines or gaps to replace, insert, cut or paste, then give the new content. `:` headers take `+` body rows; colonless ops take none.

<headers>
Section header `[PATH#TAG]`: `TAG` is the 4-hex snapshot from the latest `read`/`search`, REQUIRED on every section. New files go through `write`; this edits existing files only.
</headers>

<ops>
`PUT N.=M:` replace original inclusive lines N–M with the body; one line is `PUT N.=N:`.
`PUT N*:` replace the syntactic block opening at N — its closing line is resolved for you.
`PUT <N:` / `PUT >N:` insert the body before / after line N (`<1` file head, `>$` file tail).
`PUT >N*:` insert after block N's end; to append INSIDE it use `PUT >M:`.
`CUT N.=M` / `CUT N*` delete and capture the range or block, anonymously or into `@name`.
`PUT <N @name` / `>N @name` paste a register at that gap; `PUT N.=M @name` pastes over a range.
`REM` deletes the file. `MV DEST` renames it; earlier edits apply to the source.
Ranges name the original inclusive lines you touch — body length is irrelevant.
</ops>

<body-rows>
Only under a `:` header. Each row is verbatim `+TEXT`, leading whitespace preserved; bare `+` is blank. NEVER write `-old`, bare or context rows — the range deletes, the body is final content. Keep a line by excluding it from every range.
</body-rows>

<rules>
- Touch displayed lines only — undisplayed hunks are REJECTED. Elisions (`…`, `..`, collapsed `N-M:` rows) are UNSEEN: NEVER hunk into or across one, `read` first.
- `PUT N*:` resolves exactly node N. Decorators and doc-comments are separate nodes — point N at the first. Block ops take the OPENING line, never the closer.
- Move with `CUT` then `PUT`; registers persist. NEVER reformat with this tool.
</rules>

{{critical}}
