Patches files given diff hunks. Primary tool for existing-file edits.

**Hunk headers:** `@@` bare when the context lines alone are unique; otherwise `@@ $ANCHOR` with the anchor copied verbatim from the file — a full function signature, class declaration, unique string literal, or an uncommonly named config key. On "Found multiple matches": add context lines, split into hunks with separate anchors, or lengthen the anchor.

**Context lines:** enough ` `-prefixed lines to make the match unique, usually 2–8. When editing a structured block (nested braces, tags, indented regions) include its opening and closing lines so the edit stays inside the block.

<parameters>
```ts
// Input is { path: string, edits: Entry[] }; `path` applies to every entry.
type Entry =
   // One or more hunks. Each begins "@@" (anchor optional), holds only
   // ' ' | '+' | '-' lines, and contains at least one change.
   | { op: "update", diff: string }
   // Full file content, no prefixes.
   | { op: "create", diff: string }
   | { op: "delete" }
   // Update and move from the top-level path.
   | { op: "update", rename: string, diff: string }
```
</parameters>

Failures report "Found multiple matches" (anchor or context not unique), "No match found" (context absent — wrong content or a stale read), or a diff syntax error.

{{critical}}
