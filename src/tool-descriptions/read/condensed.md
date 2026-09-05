Read files, directories, archives, SQLite, images, documents, internal resources and web URLs via `path`. SHOULD parallelize independent reads. Prefer `read` over browser for the web.

## Selectors — append `:<sel>` to `path` (`src/foo.ts:50-200`, `db.sqlite:users:42`)

- `:50` / `:50-` from line 50 | `:50-200` inclusive | `:50+150` 150 lines from 50 | `:-60` last 60 | `:5-16,960-973` several ranges
- `:raw` verbatim, no anchors or prefixes; combines as `:2-4:raw` or `:raw:2-4`
- `:conflicts` one line per unresolved git merge-conflict block
- `:img` rasterize a local `.svg`/`.svgz` to PNG, when visual layout matters
- `?q=<question>` on an image: a vision model answers in text, no pixels returned
- Video needs system `ffmpeg`/`ffprobe`: bare read → preview grid + metadata; `:412` extracts that frame; `:90s` / `:1h5m42s` seek

## Source kinds

- Parseable code, no selector → structural summary, bodies elided; the footer names the recovery selector.
{{hashline}}
- Directory → depth-limited listing. SQLite: `f.db` tables | `f.db:table` schema+rows | `f.db:table:key` by primary key | `?limit=` `?where=` `?q=SELECT`.
- Archives (`.zip` `.jar` `.whl` `.tar[.gz|.xz|.zst]` `.rar` `.7z` `.iso` `.deb` `.rpm` `.asar`, bare `.gz` `.xz` `.zst`, more): `archive.ext:path/inside` reads one member.
- Documents → text. Notebooks → editable cells. Images → decoded inline. SVG reads as text unless `:img`. `:raw` bypasses every converter.
- URLs → reader-mode text/markdown; `:raw` → untouched HTML. A bare `host:port` needs a trailing slash.
- `artifact://<id>` recovers spilled output; internal URIs take selectors too.
- `ssh://host/<path>` reads a remote file or dir (UTF-8, ≤1 MiB); bare `ssh://` lists hosts. Percent-encode literal `:` `?` `#`.

{{critical}}
