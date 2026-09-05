Edit files with the `apply_patch` shell command: a stripped-down, file-oriented diff, easy to parse and safe to apply.

```
*** Begin Patch
[ one or more file sections ]
*** End Patch
```

Every section MUST carry an action header:

- `*** Add File: <path>` — create it; every following line starts `+`.
- `*** Delete File: <path>` — remove it; nothing follows.
- `*** Update File: <path>` — patch in place. An immediate `*** Move to: <new path>` renames it. Then one or more `@@` hunks, whose lines start with a space, `-`, or `+`.

Context: 3 lines immediately before and after each change. For two changes within 3 lines of each other, do NOT repeat the first change's trailing context as the second's leading context. When 3 lines do not identify the code uniquely, put its class or function on the `@@`; when one `@@` plus context still cannot, stack several:

```
@@ class BaseClass
@@ 	 def method():
[3 lines of pre-context]
- [old_code]
+ [new_code]
[3 lines of post-context]
```

Operations combine in one patch:

```
*** Begin Patch
*** Add File: hello.txt
+Hello world
*** Update File: src/app.py
*** Move to: src/main.py
@@ def greet():
-print("Hi")
+print("Hello, world!")
*** Delete File: obsolete.txt
*** End Patch
```

Grammar: `Patch := Begin { FileOp } End`, `Hunk := "@@" [header] { (" "|"-"|"+") text } [ "*** End of File" ]`.

Every section MUST use an Add/Delete/Update header, new-file lines MUST start `+`, and file references are relative — NEVER absolute.
