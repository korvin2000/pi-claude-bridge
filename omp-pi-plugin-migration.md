# Pi / pi-mono → Oh My Pi (OMP) Plugin & Extension Compatibility Guide

**Research snapshot:** 2026-09-04  
**Target:** current Oh My Pi (`omp`) and current Pi / former `pi-mono` ecosystem  
**OMP version checked during research:** `@oh-my-pi/pi-coding-agent` **18.1.10**  
**Pi version checked during research:** `@earendil-works/pi-coding-agent` **0.85.0**

> This document focuses on **installing, running, adapting, and maintaining Pi extensions/packages under Oh My Pi**.  
> OMP is a fork/descendant of Pi and retains a substantial compatibility layer, but the two ecosystems are **not identical**. Many old 2026 workarounds are now obsolete because OMP added explicit `pi` manifest support and a legacy-Pi module compatibility loader.

---

# 1. Executive summary

For a modern OMP installation, **do not begin by copying files and globally replacing import names**. The best current strategy is:

1. **Upgrade OMP first.** Pi compatibility has changed rapidly and many failures reported against OMP 15–17 were fixed later.
2. Inspect the Pi package's `package.json`.
3. If it already has:
   ```json
   {
     "pi": {
       "extensions": ["./..."]
     }
   }
   ```
   try installing it directly:
   ```bash
   omp install <npm-package>
   # or
   omp install github:<owner>/<repo>
   ```
4. For a local checkout, test the extension/package with:
   ```bash
   omp -e ./path/to/extension.ts
   omp -e ./path/to/package-directory
   ```
   OMP's `-e` is a **filesystem path loader**, not Pi's one-shot npm/git fetch mechanism.
5. OMP currently understands legacy/current Pi import scopes through its compatibility loader, including:
   - `@mariozechner/pi-*` — historical Pi scope
   - `@earendil-works/pi-*` — current Pi scope
   - `@oh-my-pi/pi-*` — OMP scope
   - bare `@sinclair/typebox` / `typebox` through a TypeBox compatibility facade
6. If installation succeeds but runtime fails, the problem is usually one of:
   - a **Pi API/export** that OMP's compatibility shim does not yet emulate;
   - use of **private/internal Pi APIs** rather than `ExtensionAPI`;
   - a Pi package resource/layout feature that does not map 1:1 to OMP;
   - TypeBox submodule APIs that are intentionally not remapped;
   - a host/TUI/model-registry semantic difference;
   - an old OMP version with a now-fixed compiled-Bun loader bug.
7. For plugin authors, the most robust long-term architecture is:
   - shared implementation/core;
   - thin `src/pi.ts` adapter;
   - thin `src/omp.ts` adapter;
   - both `pi.extensions` and `omp.extensions` manifests.

A single shared entry point can work for plugins using only the common `ExtensionAPI` subset. Real-world OMP/Pi packages use both patterns.

---

# 2. Terminology: Pi "extension/package" vs OMP "extension/plugin"

The names are confusing because the two projects evolved from the same codebase but use overlapping terminology.

| Concept | Pi | OMP | Practical meaning |
|---|---|---|---|
| Executable extension module | **Extension** | **Extension** | TS/JS module exporting a factory that receives an extension API |
| Installable distribution | **Pi package** | **Plugin** | npm/git/local package that can contain extensions plus other resources |
| LLM-callable function | Tool registered by extension | Tool registered by extension or custom-tool capability | Executable model-facing function |
| Static behavioral guidance | Skill | Skill | Prompt/context resource |
| User command | Extension command / prompt template | Extension command / command capability | Slash-command behavior |
| Event interceptor | Extension events | Extension or Hook | OMP treats extensions as the preferred, richer mechanism |
| Package metadata | `package.json#pi` | `package.json#omp`, with fallback to `#pi` | Tells the host what the package exposes |

A useful mental model:

> **Pi extension ≈ OMP extension.**  
> **Pi package ≈ OMP plugin.**

An OMP **plugin is mainly a packaging/install/state container**. It may expose one or more extension entry points and other capabilities. An OMP **extension is executable code loaded into the agent process**.

---

# 3. Why Pi compatibility is much better now than early 2026 reports imply

Several of the linked GitHub issues capture a moving target.

## March 2026: manual copying and namespace edits

Issue **#441** documented an early workaround for `pi-autoresearch`:

```bash
cp -r pi-autoresearch/extensions/pi-autoresearch ~/.omp/agent/extensions/
cp -r pi-autoresearch/skills/autoresearch-create ~/.omp/agent/skills/
```

followed by an import rewrite such as:

```bash
sed -i 's/@mariozechner\/pi-/@oh-my-pi\/pi-/g' ...
```

That was useful at the time, but should now be treated as **historical fallback guidance**, not the preferred migration method.

## Spring 2026: `pi.extensions` compatibility landed

Issue **#433** originally identified a plugin-manifest mismatch. Its final closure notes that OMP had implemented:

- `package.json` manifest lookup using `pkg.omp || pkg.pi`;
- support for `extensions[]`;
- extension disabling wired into capability loading.

That means a Pi package with a conventional `pi.extensions` manifest became structurally installable by OMP.

## June–August 2026: compatibility became a real loader subsystem

Issue **#2166** explains the modern split:

- `omp -e` / `--extension` loads a **local file or directory**;
- `omp install` installs an npm/git/local **plugin package**;
- `pi.extensions` is accepted;
- Pi package imports are automatically mapped through a compatibility layer.

Subsequent OMP releases fixed many individual compatibility gaps, including:

- directory entries such as `pi.extensions: ["./extensions"]`;
- relative assets and module graph loading;
- compiled Bun/bunfs resolution failures;
- missing legacy Pi helper exports;
- `SettingsManager`;
- built-in tool factories such as `createEditTool` / `createWriteTool`;
- legacy Pi AI/model helpers.

**Conclusion:** old issue comments are valuable for understanding failure modes, but **always compare them with current source and changelog before applying their workaround**.

---

# 4. Current installation paths

## 4.1 Install an npm Pi package as an OMP plugin

If the package is published to npm and has a usable `omp` or `pi` manifest:

```bash
omp install pi-token-burden
```

or equivalently through the plugin command surface:

```bash
omp plugin install pi-token-burden
```

OMP installs user plugins under its plugin data root, normally:

```text
~/.omp/plugins/
├── package.json
├── node_modules/
└── omp-plugins.lock.json
```

The runtime then discovers enabled plugin packages and resolves their `omp.extensions` or legacy `pi.extensions`.

### Important Pi syntax difference

Pi documentation commonly uses source prefixes:

```bash
pi install npm:@foo/bar
```

For OMP, normal npm package names are generally passed directly:

```bash
omp install @foo/bar
```

Do **not** mechanically copy Pi CLI syntax into OMP.

---

## 4.2 Install a Pi extension/package from GitHub

Current OMP's plugin manager accepts git/GitHub forms. A concise supported form is:

```bash
omp install github:<owner>/<repo>
```

Example:

```bash
omp install github:Whamp/pi-token-burden
```

OMP's implementation also accepts several git shorthand/full URL forms; use `github:owner/repo` when possible because it is unambiguous.

---

## 4.3 Test a local clone without installing it

For a single extension file:

```bash
omp -e ./src/index.ts
```

For a package/directory:

```bash
omp -e ./my-pi-package
```

Directory resolution currently prefers:

1. `package.json` with `omp.extensions`;
2. legacy `pi.extensions`;
3. `index.ts`;
4. `index.js`;
5. supported one-level directory scanning rules.

This is the fastest way to separate **source compatibility** from **plugin-manager/install compatibility**.

---

## 4.4 Link/install a local package as a plugin

For plugin development:

```bash
omp install ./my-plugin
```

or use the explicit plugin link workflow where appropriate:

```bash
omp plugin link ./my-plugin
```

The package should have a valid `package.json`, especially a package `name`, and preferably an `omp` manifest.

---

# 5. Critical difference: `pi -e` and `omp -e` are not equivalent

Current Pi supports one-shot remote package loading:

```bash
pi -e npm:@foo/bar
pi -e git:github.com/user/repo
```

Pi downloads the package into a temporary location for that run.

OMP's `-e` currently means:

> **load this local filesystem extension file/directory**

Therefore:

```bash
omp -e npm:foo
```

is not the Pi-equivalent remote workflow.

Use:

```bash
omp install foo
# restart/start omp
```

or:

```bash
omp install github:user/repo
```

For development/local checkout:

```bash
omp -e ./repo/src/index.ts
```

This difference alone explains a significant number of “OMP ignored `-e`” reports.

---

# 6. Manifest compatibility

## 6.1 Native OMP plugin manifest

Preferred OMP form:

```json
{
  "name": "my-omp-extension",
  "version": "1.0.0",
  "omp": {
    "extensions": [
      "./src/main.ts"
    ]
  }
}
```

## 6.2 Legacy/current Pi extension manifest accepted by OMP

OMP also accepts:

```json
{
  "name": "my-pi-extension",
  "version": "1.0.0",
  "pi": {
    "extensions": [
      "./src/main.ts"
    ]
  }
}
```

OMP gives precedence to `package.json#omp` and falls back to `package.json#pi`.

## 6.3 Best dual-target manifest

For maintained cross-compatible packages, explicitly publish both:

```json
{
  "name": "my-pi-omp-extension",
  "version": "1.0.0",
  "type": "module",
  "omp": {
    "extensions": [
      "./dist/omp.js"
    ]
  },
  "pi": {
    "extensions": [
      "./dist/pi.js"
    ]
  }
}
```

If the same code works on both hosts:

```json
{
  "omp": {
    "extensions": ["./dist/index.js"]
  },
  "pi": {
    "extensions": ["./dist/index.js"]
  }
}
```

This dual declaration is clearer than relying indefinitely on OMP's fallback behavior.

---

# 7. Pi package resources are broader than the OMP plugin manifest type

Current Pi package documentation allows:

```json
{
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

Pi can also auto-discover those conventional directories if no `pi` manifest exists.

Current OMP's `PluginManifest` type directly defines fields such as:

- `extensions`
- `tools`
- `hooks`
- `commands`
- `features`
- `settings`

and OMP's plugin capability provider separately convention-scans plugin roots for:

```text
skills/
hooks/pre/
hooks/post/
tools/
commands/
rules/
prompts/
.mcp.json
agents/
```

This creates an important subtle difference:

> Do not assume that every arbitrary path declared in Pi-specific fields such as `pi.skills`, `pi.prompts`, or `pi.themes` is consumed by OMP with exactly Pi's semantics.

A Pi package that uses conventional sibling directories is much easier for OMP to consume because OMP can discover them through its own capability providers.

### Practical migration rule

If a Pi package has:

```json
"pi": {
  "skills": ["./weird/custom/skill-location"]
}
```

prefer reorganizing the OMP version into:

```text
skills/
  ...
```

or provide explicit OMP-native packaging/discovery logic.

For extensions, the story is stronger: `pi.extensions` is an explicitly supported compatibility field.

---

# 8. Native filesystem locations differ

## Pi

Common Pi roots:

```text
~/.pi/agent/extensions/
.pi/extensions/
```

## OMP

Current OMP native extension roots:

```text
~/.omp/agent/extensions/
<cwd>/.omp/extensions/
```

OMP does **not** treat `.pi/extensions/` as its native auto-discovery root merely because it understands a `pi.extensions` package manifest.

Therefore a manual Pi setup such as:

```text
~/.pi/agent/extensions/foo/
```

does not automatically become visible to OMP.

For loose extensions, move/copy/link them to the OMP root or configure an explicit path. For packaged extensions, prefer `omp install`.

---

# 9. What OMP's automatic Pi compatibility layer currently does

OMP now has a dedicated `legacy-pi-compat.ts` loader and companion compatibility shims.

The current source explicitly recognizes historical/current scopes for host Pi packages:

```text
@mariozechner/*
@earendil-works/*
@oh-my-pi/*
```

for core `pi-*` packages such as:

```text
pi-agent-core
pi-ai
pi-coding-agent
pi-natives
pi-tui
pi-utils
```

This matters because the Pi ecosystem itself moved package ownership/scope over time:

```text
@mariozechner/*        historical
@earendil-works/*      current Pi
@oh-my-pi/*            OMP
```

A modern OMP should therefore not require a source-level `sed` rename merely to resolve these known host packages.

The loader also handles compatibility shims for Pi package-root exports whose location or implementation changed in OMP.

---

# 10. TypeBox compatibility—and its boundary

Pi historically/currently uses TypeBox-style schemas heavily. OMP's native authoring guidance now favors host-injected schema builders:

```ts
const z = pi.zod;
```

OMP also exposes:

```ts
pi.arktype
pi.typebox
```

for compatibility.

The legacy Pi loader redirects **bare** TypeBox imports such as:

```ts
import { Type } from "@sinclair/typebox";
```

or:

```ts
import { Type } from "typebox";
```

to OMP's compatibility facade.

However, current OMP source explicitly says TypeBox **submodules** are intentionally not remapped, for example:

```ts
@sinclair/typebox/compiler
```

A Pi plugin relying on TypeBox-specific compiler/value internals may therefore need to:

1. ship TypeBox as a real runtime dependency; or
2. replace that usage with OMP's schema/validation surface; or
3. isolate it behind a host-specific adapter.

This is a good example of the difference between **source-level compatibility** and **full ecosystem API compatibility**.

---

# 11. Extension API compatibility: broad, but not a guarantee

The basic factory shape is essentially aligned.

## Pi-style concept

```ts
export default function (pi: ExtensionAPI) {
  pi.on(...);
  pi.registerTool(...);
  pi.registerCommand(...);
}
```

## OMP-native minimal extension

```ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("loaded", "info");
  });
}
```

This common architecture is why many Pi extensions can run with little or no modification.

The danger appears when an extension imports **host implementation details** rather than operating through `ExtensionAPI`.

Examples of historically reported compatibility gaps include missing Pi exports such as:

- `SettingsManager`;
- `createFindToolDefinition`;
- `createEditTool`;
- `createWriteTool`;
- model helpers;
- model-registry facade methods.

OMP has added shims for many of these over time. For example, current OMP source contains a `SettingsManager` compatibility shim and legacy built-in tool factories that did not exist in older versions.

### Design lesson

A package using only the public extension API has the highest chance of running on both hosts.

A package that imports classes/functions directly from the Pi coding-agent internals has a higher maintenance cost and should generally use a Pi/OMP adapter layer.

---


# 12. Official OMP `porting-from-pi-mono.md`: the most useful divergence map

A further official OMP source discovered during research is:

- <https://github.com/can1357/oh-my-pi/blob/main/docs/porting-from-pi-mono.md>

It is written primarily for **porting upstream Pi/pi-mono changes into the OMP codebase**, rather than for installing third-party plugins. Nevertheless, its **“Intentional Divergences”** section is extremely valuable for plugin migration because it documents where apparently similar APIs deliberately differ.

Key divergences relevant to extensions/plugins:

| Upstream Pi | OMP | Migration implication |
|---|---|---|
| `jiti` TypeScript loading | native Bun `import()` | avoid assumptions about Jiti-specific resolution/transforms |
| `pkg.pi` manifest | `pkg.omp` preferred, `pkg.pi` fallback | dual manifests are the clearest maintained package format |
| `StringEnum` from Pi AI | OMP-native `Type.Enum(...)` / `pi.arktype.enumerated(...)` | for OMP-native ports, use OMP schema APIs; current legacy Pi shim can still emulate historical `StringEnum` for compatibility |
| `formatSize` from Pi coding-agent | `formatBytes` from `@oh-my-pi/pi-utils` | direct host helper imports may require adapter mapping |
| `FooterDataProvider` | `StatusLineComponent` | footer/status-line plugins are not structurally identical |
| `ctx.ui.setHeader()` / `setFooter()` | current OMP extension contexts expose no-op stubs | code may load but have no visible effect |
| `ctx.ui.addAutocompleteProvider()` | supported with OMP editor constraints | custom `triggerCharacters` behavior is not identical |
| `sessionManager.appendSessionInfo(name)` | `sessionManager.setSessionName(name)` | API-level rename/semantic port needed if used directly |
| upstream resource/package/settings managers | OMP capability discovery + `Settings` + `EventBus` | OMP supplies legacy shims, but native architecture is different |
| upstream tool factories | OMP `ToolSession`/built-in registry architecture | direct tool-factory imports are more fragile than `ExtensionAPI` tool registration |

The guide also explicitly says both historical `@mariozechner/*` and current `@earendil-works/*` scopes map to `@oh-my-pi/*` when doing a true source port.

## Compatibility shim vs native OMP port

This distinction is important:

- **Compatibility mode:** keep the Pi extension source mostly unchanged and let OMP's `legacy-pi-*` shims emulate upstream APIs.
- **Native port:** rewrite host-specific pieces to OMP's current architecture (`StatusLineComponent`, OMP schema builders, capability discovery, OMP settings/tool architecture).

The first minimizes work for users. The second is more stable for maintainers when the plugin deeply touches the host.

## A concrete example: `StringEnum`

The official porting guide says OMP-native code should not expect `StringEnum` from the canonical OMP `pi-ai` package. However, current `legacy-pi-ai-shim.ts` **does implement a compatibility `StringEnum()`** for legacy extensions.

Therefore:

```text
Pi plugin consumed by OMP:
    leave the upstream import alone first; current compatibility shim may satisfy it.

Plugin intentionally ported to OMP:
    migrate to OMP's native schema surface instead of depending on the legacy shim.
```

This is a recurring pattern throughout OMP: **the legacy shim can support an API that is intentionally absent from the canonical OMP architecture**. That is another reason not to blindly replace `@earendil-works/*` imports with `@oh-my-pi/*` in third-party source.

---

# 13. Recommended compatibility architecture for plugin authors

## Pattern A — one common entry point

Use this when your plugin sticks to the common API surface.

```text
src/
  index.ts
package.json
```

```json
{
  "omp": {
    "extensions": ["./src/index.ts"]
  },
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Good fit:

- lifecycle events;
- simple tools;
- slash commands;
- UI notifications;
- APIs known to exist on both hosts.

### Real examples

- `mentalfl0w/smart-approve`
- `rezhajulio/omp-model-profiles`

Both advertise the same extension entry to OMP and Pi.

---

## Pattern B — shared core + thin host adapters **(recommended)**

Use this for anything substantial.

```text
src/
  core/
    engine.ts
    config.ts
    logic.ts
  pi.ts
  omp.ts
dist/
  pi.js
  omp.js
```

`package.json`:

```json
{
  "omp": {
    "extensions": ["./dist/omp.js"]
  },
  "pi": {
    "extensions": ["./dist/pi.js"]
  }
}
```

Conceptual adapter:

```ts
// src/omp.ts
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { installCore } from "./core/engine";

export default function ompEntry(pi: ExtensionAPI) {
  installCore({
    registerTool: def => pi.registerTool(def),
    notify: (message, level) => {
      // bind through an event/command context, not at module load
    },
    schema: pi.zod
  });
}
```

Pi adapter:

```ts
// src/pi.ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { installCore } from "./core/engine";

export default function piEntry(pi: ExtensionAPI) {
  installCore({
    registerTool: def => pi.registerTool(def),
    schema: Type
  });
}
```

The actual adapter contract should be much narrower than the complete host API.

### Why this is better

- isolates package namespace changes;
- avoids depending on the runtime compatibility shim for maintainers' own code;
- allows OMP-native `pi.zod`/settings/features while keeping Pi-native behavior;
- makes host differences obvious during code review;
- lets tests target each host independently;
- prevents a newly added Pi API from silently becoming an OMP runtime dependency.

### Real examples

#### `processmission/pi-usage-status`

Its package contains both:

```json
"omp": {
  "extensions": ["./src/index.ts"],
  "settings": { ... }
},
"pi": {
  "extensions": ["./src/pi.ts"]
}
```

The Pi file is a thin adapter that imports Pi's `CustomEditor` and delegates to shared implementation.

This is one of the clearest compatibility designs found in the research.

#### `mentalfl0w/omp-codex-reserve`

Publishes separate built outputs:

```json
"omp": {
  "extensions": ["./dist/omp.js"]
},
"pi": {
  "extensions": ["./dist/pi.js"]
}
```

and declares both host packages as optional peers.

That is a strong pattern when the plugin is actively supported on both ecosystems.

---

# 14. Package dependency strategy

For a dual-target package, avoid accidentally bundling a second copy of host internals unless that is intentional.

A useful pattern is optional peer dependencies:

```json
{
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.x",
    "@oh-my-pi/pi-coding-agent": ">=18.x"
  },
  "peerDependenciesMeta": {
    "@earendil-works/pi-coding-agent": {
      "optional": true
    },
    "@oh-my-pi/pi-coding-agent": {
      "optional": true
    }
  }
}
```

Exact ranges should reflect the APIs actually used.

Third-party libraries that are genuinely part of your plugin runtime belong in ordinary runtime dependencies.

### Avoid this anti-pattern

Do not “fix” an OMP resolution failure by blindly installing many copies of:

```text
@oh-my-pi/pi-coding-agent
@oh-my-pi/pi-ai
@oh-my-pi/pi-tui
```

inside the plugin.

OMP's compatibility loader intentionally maps known host packages to host-bundled copies to preserve host identity and compiled-binary behavior. A duplicated private package graph can create more subtle problems than the original missing import.

---

# 15. Conversion workflow: Pi package → maintainable OMP plugin

The following sequence is the most reliable.

## Step 1 — update and record versions

```bash
omp -v
bun -v
```

Record the exact versions before debugging.

Compatibility bugs in old compiled builds can look identical to a plugin source bug.

---

## Step 2 — inspect the package manifest

```bash
jq '{name, version, omp, pi, main, module, exports, dependencies, peerDependencies}' package.json
```

Classify it:

### Case 1: native OMP manifest exists

```json
"omp": {
  "extensions": [...]
}
```

Use OMP normally.

### Case 2: only `pi.extensions` exists

Try direct OMP install first. Current OMP intentionally accepts it.

### Case 3: no `omp` or `pi` manifest

Pi may still load convention directories, but OMP's installed-plugin runtime discovery can skip packages with no OMP/Pi manifest.

For a package you maintain, add:

```json
"omp": {
  "extensions": ["./extensions"]
}
```

or explicit files.

For a throwaway local test:

```bash
omp -e ./repo
```

may still be useful because explicit directory loading follows extension-directory rules.

---

## Step 3 — audit host imports

```bash
rg -n \
  '@(mariozechner|earendil-works|oh-my-pi)/pi-|@sinclair/typebox|from "typebox"|from '\''typebox'\''' \
  .
```

Then separate imports into:

1. **host public types/API**;
2. **host helper exports**;
3. **TUI internals**;
4. **model/provider internals**;
5. **TypeBox submodules**;
6. **third-party dependencies**.

The further down that list, the more likely you need an adapter.

---

## Step 4 — try unmodified local loading

```bash
omp -e ./src/index.ts
```

or:

```bash
omp -e .
```

If it loads, resist the urge to rewrite working imports.

---

## Step 5 — try plugin installation

npm:

```bash
omp install <package>
```

GitHub:

```bash
omp install github:<owner>/<repo>
```

OMP's installer validates declared extension entry points. Validation failure is useful: it often exposes a named-export or module-resolution problem before runtime.

---

## Step 6 — inspect OMP logs

OMP intentionally writes extension diagnostics to structured log files instead of corrupting the TUI.

```bash
tail -f ~/.omp/logs/omp.$(date +%F).*.log
```

Useful search:

```bash
rg -n 'Failed to load extension|legacy-pi|ResolveMessage|not found|extension validation' \
  ~/.omp/logs/
```

---

## Step 7 — classify the failure before changing code

| Error class | Likely cause | Preferred action |
|---|---|---|
| `Cannot find module @earendil-works/pi-*` | Old OMP or loader regression | Upgrade OMP; verify current compat loader |
| `Export named X not found` | Pi API gap in OMP shim | Check latest OMP/changelog; then adapter or rewrite to public ExtensionAPI |
| `Cannot find @sinclair/typebox/compiler` | TypeBox submodule intentionally outside basic remap | Vendor dependency or replace API |
| package installs but no commands/tools appear | Missing/incorrect `omp`/`pi` manifest or entry path | Inspect `package.json` and logs |
| `-e package-name` does nothing | OMP `-e` expects a path | use `omp install package-name` |
| resource skill/prompt missing | Pi resource manifest semantics differ | use OMP conventional sibling directories / OMP-specific packaging |
| error only in compiled/Homebrew binary | possible loader/bundled-runtime issue | upgrade; compare install modes; file a minimal OMP bug |
| extension calls runtime action during import/load | host lifecycle violation | register during load; execute in event/tool/command |
| UI/model registry semantics differ | host-specific implementation | thin Pi/OMP adapter |

---

# 16. OMP-native extension authoring differences worth adopting

When converting rather than merely consuming a Pi plugin, target OMP's public API instead of only making imports resolve.

## Schema builders

OMP-native:

```ts
const z = pi.zod;

pi.registerTool({
  name: "example",
  parameters: z.object({
    text: z.string()
  }),
  async execute(...) { ... }
});
```

Also available:

```ts
pi.arktype
pi.typebox
```

Use `pi.typebox` mainly for compatibility; prefer host-native schema APIs in new OMP-specific code.

---

## Runtime actions must not happen during module load

OMP documents this explicitly.

Bad:

```ts
export default function (pi) {
  pi.sendMessage(...); // too early during extension initialization
}
```

Better:

```ts
export default function (pi) {
  pi.on("session_start", async () => {
    pi.sendMessage(...);
  });
}
```

Similarly, background callbacks should be tied to OMP lifecycle-aware context helpers where available rather than raw detached timers.

---

## Extension over hook for new OMP code

OMP treats the extension API as the preferred superset for:

- tools;
- commands;
- events;
- providers/shortcuts/CLI integration;
- lifecycle behavior.

If porting a Pi extension, preserve it as an extension unless a very narrow OMP hook is specifically more appropriate.

---

# 17. `pi-autoresearch` as a modern compatibility case study

The current `davebcn87/pi-autoresearch` package is useful because it resembles the scenario from issue #441 but has evolved since the original workaround.

Its current package manifest contains:

```json
"pi": {
  "extensions": [
    "./extensions"
  ],
  "skills": [
    "./skills"
  ]
}
```

Its extension source imports current Pi packages:

```ts
@earendil-works/pi-coding-agent
@earendil-works/pi-ai
@earendil-works/pi-tui
@sinclair/typebox
```

and also uses multiple relative modules.

### What changed relative to the old #441 advice?

Old advice assumed manual source rewriting from the Mario Zechner scope.

Current OMP:

- recognizes the current `@earendil-works` Pi scope;
- supports `pi.extensions`;
- supports extension directory manifest entries;
- rewrites the extension-owned dependency graph;
- supports TypeBox root compatibility;
- scans conventional sibling `skills/` directories in installed/plugin package roots.

Therefore the correct modern first attempt is no longer “copy + sed”; it is:

```bash
omp install github:davebcn87/pi-autoresearch
```

or a local test:

```bash
git clone https://github.com/davebcn87/pi-autoresearch.git
cd pi-autoresearch
omp -e .
```

**Important:** this is a structural compatibility assessment from current loader/package rules, not a claim that every current `pi-autoresearch` feature has been exhaustively runtime-tested under OMP 18.1.10.

If a concrete feature fails, inspect the specific missing export or semantic API rather than applying global namespace rewrites.

---

# 18. `omp-pi-install`: where it fits today

Repository:

- <https://github.com/rayoplateado/omp-pi-install>

It provides an OMP extension with commands such as:

```text
/pi-install
/pi-uninstall
/pi-list
/pi-update
```

Its implementation does considerably more than a simple installer:

1. clones a Pi repository;
2. detects extensions/skills;
3. can bundle multi-file extensions with `Bun.build`;
4. rewrites Pi package imports;
5. injects host runtime objects;
6. moves some module-scope code into the extension factory;
7. supplies some TUI polyfills;
8. installs third-party dependencies;
9. copies resources into `~/.omp/agent/...`.

### Why it is useful

- good source of migration experiments;
- useful fallback for older Pi packages;
- useful when a package is not shaped like an installable OMP plugin;
- demonstrates how hard compatibility becomes once a plugin uses host internals.

### Why it should **not** be the default on current OMP

Current OMP already has a native legacy-Pi compatibility loader. Duplicating that job through source transformation creates more moving parts.

More importantly, the current `omp-pi-install` source inspected during this research explicitly rewrites the historical `@mariozechner/pi-*` scope. Current Pi packages now use `@earendil-works/pi-*`, while OMP's own compatibility layer already recognizes both.

Its transformations are also invasive: bundling, moving module-scope code, and polyfilling APIs can change program semantics.

### Recommendation

Treat `omp-pi-install` as:

> **a compatibility/conversion fallback and implementation reference**, not the primary installation path for OMP 18.x.

First try OMP's own `omp install` + built-in compatibility layer.

---

# 19. Why manual global `sed` rewrites are now risky

A rewrite like:

```bash
sed -i 's/@earendil-works\/pi-/@oh-my-pi\/pi-/g' ...
```

looks harmless but can be wrong for several reasons:

1. namespace equality does not imply API equality;
2. OMP's compatibility shim may intentionally emulate an upstream symbol that the canonical OMP package no longer exports at the same path;
3. a source change can bypass the special legacy path that would have provided compatibility;
4. multiple host package copies can appear;
5. upstream Pi may introduce a new API whose OMP equivalent has a different name/semantics;
6. code may be intended to remain dual-target.

Use source rewrites only after identifying a specific incompatible API.

---

# 20. Compatibility levels

A practical classification for Pi plugins:

## Level 0 — manifest-only

Characteristics:

- ordinary default extension factory;
- no host-internal imports;
- simple tools/events/commands;
- `pi.extensions` exists.

Expected work:

```text
none or add omp manifest
```

Try direct install.

---

## Level 1 — legacy import compatibility

Characteristics:

- imports known Pi package roots;
- TypeBox root;
- ordinary public Pi extension exports.

Expected work:

```text
usually none on current OMP
```

Rely on OMP compatibility loader; verify exact OMP version.

---

## Level 2 — packaging/resource differences

Characteristics:

- skills/prompts/themes declared through Pi-specific package conventions;
- no OMP/Pi manifest;
- unusual resource paths.

Expected work:

- add `omp` manifest;
- use OMP conventional capability directories;
- possibly split package layout.

---

## Level 3 — API shim gaps

Characteristics:

- imports specific Pi helper functions/classes;
- uses Pi model-registry helpers;
- built-in tool factories;
- TUI internals.

Expected work:

- upgrade OMP first;
- check whether shim was added;
- otherwise thin host adapter.

---

## Level 4 — deep runtime coupling

Characteristics:

- monkey patches Pi classes/prototypes;
- imports unpublished internals;
- assumes exact Pi TUI tree;
- depends on Pi's package manager/session internals;
- uses host-specific model/provider registry implementation.

Expected work:

- real port;
- separate `pi.ts` and `omp.ts`;
- test both hosts;
- avoid trying to solve by import aliases alone.

---

# 21. Source-compatible vs behavior-compatible

A plugin can pass import/installation validation and still be behaviorally incompatible.

Examples:

- UI component exists but lifecycle timing differs;
- model registry exposes similar information through different methods;
- host built-in tool shape differs;
- shortcut names are reserved in OMP;
- error handling differs;
- extension events share names but not all context semantics;
- plugin expects Pi's package resources to be loaded before extension initialization.

Therefore define compatibility in three layers:

1. **Packaging compatibility** — host discovers the package.
2. **Module/API compatibility** — source imports and factory load.
3. **Behavioral compatibility** — tools/events/UI actually work correctly.

A real migration test must cover all three.

---

# 22. Testing matrix for a dual Pi/OMP package

At minimum:

| Test | Pi | OMP |
|---|---:|---:|
| direct local extension load | `pi -e ./dist/pi.js` | `omp -e ./dist/omp.js` |
| local package directory | yes | yes |
| npm install | `pi install npm:pkg` | `omp install pkg` |
| GitHub install | Pi git syntax | `omp install github:user/repo` |
| extension registers | verify | verify |
| commands work | verify | verify |
| tools execute | verify | verify |
| event handlers fire | verify | verify |
| UI rendering | verify | verify |
| relative assets | verify | verify |
| multi-file imports | verify | verify |
| skills/prompts | verify | verify OMP capability discovery |
| binary/runtime packaging | normal Pi install | OMP compiled binary distribution |
| reload/restart | verify | verify |
| headless/print mode if supported | verify | verify |

For a package using low-level host APIs, also test:

- Linux x64;
- macOS arm64;
- the officially distributed OMP binary;
- whichever Bun version OMP declares/supports.

Historical OMP bugs were sometimes specific to compiled Bun filesystem/module resolution, so “works under standalone Bun” is not sufficient proof by itself.

---

# 23. Debugging commands

## OMP version

```bash
omp -v
```

## Installed plugins

```bash
omp plugin list
```

## Plugin diagnostics

```bash
omp plugin doctor
```

Where supported, repair mode can help with package/config drift:

```bash
omp plugin doctor --fix
```

## Inspect installed manifest

```bash
cat ~/.omp/plugins/node_modules/<pkg>/package.json | jq '.omp // .pi'
```

## Tail current OMP logs

```bash
tail -f ~/.omp/logs/omp.$(date +%F).*.log
```

## Find extension errors

```bash
rg -n \
  'Failed to load extension|extension validation|ResolveMessage|Export named|Cannot find module|legacy-pi' \
  ~/.omp/logs/
```

## Audit Pi-specific imports in source

```bash
rg -n \
  '@(mariozechner|earendil-works|oh-my-pi)/pi-|@sinclair/typebox|typebox' \
  .
```

---

# 24. Troubleshooting by error signature

## `omp -e foo` silently fails

If `foo` is a package name, the likely problem is the command model.

OMP resolves `-e` as a local path.

Use:

```bash
omp install foo
```

or:

```bash
omp -e ./local/path/to/foo
```

Then inspect logs.

---

## Package appears installed but nothing loads

Check:

```bash
jq '.omp // .pi' ~/.omp/plugins/node_modules/<pkg>/package.json
```

If `null`, OMP can install/list the dependency but its runtime plugin loader may not recognize it as an enabled OMP/Pi plugin.

Add an `omp` or `pi` manifest, or test the entry directly with `-e`.

---

## `Export named 'Something' not found`

This is usually **not** an npm-resolution problem. It means the Pi extension expects an API that OMP's compatibility facade does not expose at that version.

Actions:

1. update OMP;
2. search OMP current source/changelog/issues for the symbol;
3. if still absent, replace the dependency with:
   - public `ExtensionAPI`;
   - an OMP equivalent;
   - a tiny adapter.

Do not broadly rewrite all imports.

---

## `Cannot find module ... @oh-my-pi/pi-*` in an older OMP binary

There were historical compiled-binary compatibility regressions. Current OMP has a much more sophisticated virtual-module compatibility layer.

Upgrade before attempting a source port.

If it still reproduces on current OMP, report:

```text
omp -v
bun -v
OS/arch
installation method
exact extension package/version
full Failed to load extension log line
```

---

## TypeBox compiler/value module missing

A bare root TypeBox import can be shimmed, but submodules may intentionally require real TypeBox.

Add the needed runtime dependency or port the code.

---

## Skills load in Pi but not OMP

Inspect whether the package relies only on `pi.skills` pointing to nonstandard locations.

Prefer an OMP-conventional:

```text
skills/
```

sibling directory or explicitly package the skill through the current OMP capability mechanism.

---

# 25. Recommended conversion template

## Directory layout

```text
my-extension/
├── package.json
├── src/
│   ├── core/
│   │   ├── logic.ts
│   │   └── types.ts
│   ├── pi.ts
│   └── omp.ts
├── skills/
│   └── my-skill/
│       └── SKILL.md
└── dist/
    ├── pi.js
    └── omp.js
```

## `package.json`

```json
{
  "name": "my-cross-pi-extension",
  "version": "1.0.0",
  "type": "module",
  "files": [
    "dist",
    "skills"
  ],
  "exports": {
    "./pi": "./dist/pi.js",
    "./omp": "./dist/omp.js"
  },
  "omp": {
    "extensions": [
      "./dist/omp.js"
    ]
  },
  "pi": {
    "extensions": [
      "./dist/pi.js"
    ],
    "skills": [
      "./skills"
    ]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.85.0",
    "@oh-my-pi/pi-coding-agent": ">=18.1.0"
  },
  "peerDependenciesMeta": {
    "@earendil-works/pi-coding-agent": {
      "optional": true
    },
    "@oh-my-pi/pi-coding-agent": {
      "optional": true
    }
  }
}
```

For OMP, the sibling `skills/` directory can be discovered conventionally. For Pi, explicitly listing it remains useful.

---

# 26. What to preserve in shared core

Keep the shared core host-neutral:

```ts
export interface HostAdapter {
  log(message: string): void;
  registerFoo(...args: unknown[]): void;
  getConfig(): Promise<MyConfig> | MyConfig;
}
```

Avoid putting these in shared core:

```text
@earendil-works/pi-coding-agent
@oh-my-pi/pi-coding-agent
Pi TUI classes
OMP TUI classes
model registry objects
host SettingsManager
host package manager paths
```

Those belong in adapters.

The smaller the adapter interface, the less likely upstream host evolution will affect business logic.

---

# 27. Real OMP/Pi examples and what they teach

## 26.1 `processmission/pi-usage-status` — **best dual-target architecture example**

<https://github.com/processmission/pi-usage-status>

Observed package design:

- explicit `omp` manifest;
- explicit `pi` manifest;
- OMP-specific settings;
- optional peers for both hosts;
- Pi-specific thin adapter;
- shared implementation.

**Lesson:** use separate host entrypoints only where the host really differs.

---

## 26.2 `mentalfl0w/omp-codex-reserve` — **clean built dual adapters**

<https://github.com/mentalfl0w/omp-codex-reserve>

Observed:

```json
"exports": {
  "./pi": "./dist/pi.js",
  "./omp": "./dist/omp.js"
},
"omp": {
  "extensions": ["./dist/omp.js"]
},
"pi": {
  "extensions": ["./dist/pi.js"]
}
```

**Lesson:** ideal for npm distribution when host-specific behavior is material.

---

## 26.3 `mentalfl0w/smart-approve` — **one code path for both**

<https://github.com/mentalfl0w/smart-approve>

Both manifests point to the same built file.

**Lesson:** do not create adapters merely for ceremony. If the common API is enough, one implementation is simpler.

---

## 26.4 `rezhajulio/omp-model-profiles`

<https://github.com/rezhajulio/omp-model-profiles>

Both `omp` and `pi` manifests point to the same source entry.

**Lesson:** dual metadata can make intended compatibility explicit even when no code split is needed.

---

## 26.5 Other OMP plugin examples supplied for research

Useful repositories to inspect for OMP-native patterns:

- <https://github.com/Kurptas/pi-team>
- <https://github.com/mentalfl0w/omp-session-store>
- <https://github.com/mentalfl0w/provider-retry-proxy>
- <https://github.com/mentalfl0w/omp-wechat>
- <https://github.com/notquite28/omp-ext/tree/master/plugins/omp-rewind>

These are more useful for learning current OMP plugin/extension style than for defining the Pi compatibility contract itself.

---

# 28. Historical compatibility bugs: why upgrading is step zero

Compatibility issues found during research show a repeated pattern:

1. a Pi community extension imports a valid upstream symbol;
2. OMP's shim lacks it;
3. install-time extension validation catches the missing export;
4. OMP adds a compatibility alias/facade in a later release.

Examples reported in 2026 included:

- missing `createFindToolDefinition`;
- missing `createEditTool`;
- missing model helpers such as `clampThinkingLevel`;
- missing model-registry convenience methods;
- compiled-binary resolution failures involving legacy Pi modules.

Many of those issues are closed and current source contains additional shims.

This is why a migration guide based only on one early issue comment becomes obsolete quickly.

### Maintainer implication

If you maintain a widely used Pi plugin, do not depend on OMP automatically reproducing every new Pi internal export immediately.

### Consumer implication

If a plugin fails with one missing symbol on OMP, first check whether a newer OMP already added it before forking the plugin.

---

# 29. Plugin installation validation is useful

OMP's current plugin-manager implementation validates declared extensions after install by resolving/importing them and initializing the factory against a registration surface.

If validation fails, OMP attempts to roll back the new install.

This means:

```text
omp install <pi-package>
```

is not just a package download. It is also a useful compatibility test for module-level/API problems.

A plugin that installs successfully can still have behavioral incompatibilities later, but an install-time named-export failure is a strong signal about the compatibility layer.

---

# 30. Plugins execute in-process

Both Pi and OMP extension/package ecosystems involve executable code with the user's permissions.

For migration this has a technical consequence:

- there is no separate sandbox boundary that magically normalizes runtime behavior;
- host package identity, globals, native modules, Bun behavior, and TUI objects matter;
- monkey-patching and prototype assumptions are especially fragile across forks.

Therefore aggressive source converters can make a plugin *load* while subtly changing behavior. Prefer explicit adapters for maintained code.

---

# 31. Recommended strategy by role

## If you are only a user trying to run a Pi plugin in OMP

Use this order:

```text
1. Upgrade OMP.
2. omp install <npm-name> OR omp install github:owner/repo.
3. If that fails, clone and test with omp -e ./entry-or-directory.
4. Read ~/.omp/logs/...
5. Identify exact missing export/module/resource.
6. Check current OMP source/changelog.
7. Only then patch/fork.
```

Do not begin with `sed`.

---

## If you own the Pi plugin and want official OMP support

Use:

```text
shared core
├── pi adapter
└── omp adapter
```

and publish:

```json
"pi":  { "extensions": ["./dist/pi.js"] },
"omp": { "extensions": ["./dist/omp.js"] }
```

Use a single entry only if tests prove the common API is sufficient.

---

## If the plugin is old and unmaintained

Try OMP's compatibility loader first.

If it depends heavily on historical Pi internals:

- fork it;
- add a narrow OMP adapter;
- use source conversion tools such as `omp-pi-install` only as a starting point/reference;
- commit the actual port so future OMP/Pi upgrades can be reviewed normally.

---

# 32. Source ranking

The links below are ranked by **authority + direct relevance + freshness**, not simply by amount of text.

## Tier S — primary sources

### 1. OMP current extension authoring guide

- <https://omp.sh/docs/extension-authoring>
- repository source: <https://github.com/can1357/oh-my-pi/blob/main/docs/skills/authoring-extensions.md>

**Why #1:** current official author contract, discovery paths, manifests, debugging, schema builders, lifecycle constraints.

---

### 2. OMP current extension-loading implementation documentation

- <https://github.com/can1357/oh-my-pi/blob/main/docs/extension-loading.md>
- implementation:
  <https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/plugins/legacy-pi-compat.ts>

**Why #2:** most important source for what Pi compatibility *actually does now*: path resolution, Pi scope rewriting, TypeBox behavior, module graph loading, compiled-binary compatibility.

---

### 3. OMP official `porting-from-pi-mono.md`

- <https://github.com/can1357/oh-my-pi/blob/main/docs/porting-from-pi-mono.md>

**Why #3:** official map of intentional upstream-vs-OMP architectural divergences: import scopes, Bun loading, extension manifests, UI/status-line APIs, schema helpers, resource/settings managers, and tool architecture.

**Caution:** it targets porting upstream code into OMP itself, so plugin consumers should not mechanically apply every source rewrite; OMP's runtime compatibility shims intentionally preserve some upstream APIs.

---

### 4. OMP plugin-manager / installer plumbing

- <https://github.com/can1357/oh-my-pi/blob/main/docs/plugin-manager-installer-plumbing.md>
- public docs entry supplied by user: <https://omp.sh/docs/plugins>

**Why #4:** authoritative model for install/link/git/npm, manifest precedence, plugin state, runtime discovery, validation and rollback.

---

### 5. Pi official package + extension documentation

- <https://pi.dev/docs/latest/packages>
- <https://pi.dev/docs/latest/extensions>

**Why #5:** source-side contract: what a current Pi package is allowed to assume and how current Pi package metadata differs from OMP.

---

## Tier A — highly useful compatibility evidence

### 6. OMP issue #2166 — Pi extensions/packages compatibility

- <https://github.com/can1357/oh-my-pi/issues/2166>

**Value:** best operational explanation of `omp -e` vs `omp install`, `pi.extensions`, compatibility loader, logs, and real failures.

**Caution:** some individual missing-export/binary bugs mentioned there were later fixed.

---

### 7. OMP issue #433 — extension/plugin compatibility with pi-mono

- <https://github.com/can1357/oh-my-pi/issues/433>

**Value:** records the transition from missing package compatibility to explicit `pi` manifest support.

**Caution:** read the final resolution, not only the opening complaint.

---

### 8. OMP changelog + compatibility bug fixes

Main changelog:

- <https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/CHANGELOG.md>

Representative issues:

- `createEditTool` gap: <https://github.com/can1357/oh-my-pi/issues/7094>
- model/AI shim gap: <https://github.com/can1357/oh-my-pi/issues/6648>

**Value:** proves compatibility is active and version-dependent.

---

### 9. `processmission/pi-usage-status`

- <https://github.com/processmission/pi-usage-status>

**Value:** strongest concrete dual-target design example found.

---

### 10. `mentalfl0w/omp-codex-reserve`

- <https://github.com/mentalfl0w/omp-codex-reserve>

**Value:** separate compiled Pi and OMP entrypoints with a single distribution.

---

## Tier B — useful secondary/historical sources

### 11. OMP issue #441

- <https://github.com/can1357/oh-my-pi/issues/441>

**Value:** useful history and early `pi-autoresearch` case.

**Caution:** manual copy + `sed` advice is largely superseded by current OMP compatibility machinery.

---

### 12. `rayoplateado/omp-pi-install`

- <https://github.com/rayoplateado/omp-pi-install>

**Value:** creative automated conversion/bundling approach and useful fallback/reference.

**Caution:** more invasive than native OMP compatibility; inspected source is oriented around historical `@mariozechner` rewrites while current Pi uses `@earendil-works`.

---

### 13. Other dual/native examples

- <https://github.com/mentalfl0w/smart-approve>
- <https://github.com/rezhajulio/omp-model-profiles>
- <https://github.com/mentalfl0w/omp-session-store>
- <https://github.com/mentalfl0w/provider-retry-proxy>
- <https://github.com/mentalfl0w/omp-wechat>
- <https://github.com/notquite28/omp-ext/tree/master/plugins/omp-rewind>
- <https://github.com/Kurptas/pi-team>

Use these to study style and packaging, not as the canonical compatibility specification.

---

# 33. Multilingual search findings

Searches were also performed with non-English Pi/OMP terminology, including Chinese/Russian/Japanese queries.

The useful material overwhelmingly converged on:

- OMP's official English docs/source;
- GitHub issues;
- code examples;
- mirrored/translated documentation.

A Chinese OMP documentation mirror/translation surfaced in search and can be useful for discovery, but it is necessarily secondary because OMP's plugin architecture and compatibility layer change quickly.

**Recommendation:** use translations to locate concepts, then verify every compatibility claim against current OMP `main`, current official docs, or the exact installed release.

No independent Russian/Japanese migration guide found during this research added material technical information beyond the primary sources above.

---

# 34. What should be considered "compatible"?

A useful compatibility definition for this ecosystem:

### Green — compatible

- package installs through OMP;
- extension resolves without source patch;
- commands/tools/events work;
- resources load;
- no duplicated host packages;
- behavior matches Pi expectations.

### Yellow — compatibility shim dependent

- package runs only because OMP's legacy Pi loader maps Pi imports/exports;
- no source changes required;
- maintainers should still test on each major OMP update.

This is acceptable for consumers.

### Orange — adapted

- package has explicit OMP entrypoint;
- small adapter translates schema/UI/model differences;
- shared core remains common.

This is often the **best maintainable state**.

### Red — transformed/forked

- source must be bundled/rewritten;
- module-scope behavior moved;
- private APIs polyfilled;
- heavy TUI/runtime coupling.

Treat as a real port/fork, not “compatible by default.”

---

# 35. Final recommendations

1. **Current OMP already supports a meaningful subset of the Pi ecosystem.** Treat `pi.extensions` and legacy Pi imports as first-class compatibility paths, not unsupported hacks.
2. **Upgrade before debugging.** Compatibility fixes are frequent.
3. **Use `omp install` for remote packages; `omp -e` for local paths.**
4. **Do not manually rename Pi imports unless a specific symbol/API requires a port.**
5. **Do not equate an OMP plugin with an extension.** Plugin = package/distribution/state; extension = executable factory module.
6. **Treat Pi's broader package resource model separately from `pi.extensions`.** Conventional OMP sibling capability directories are the safest bridge for skills/prompts/etc.
7. **Prefer public `ExtensionAPI`.** Every direct host-internal import increases cross-fork maintenance cost.
8. **For maintained cross-target plugins, publish both manifests.**
9. **Use shared core + thin adapters for nontrivial packages.** `pi-usage-status` and `omp-codex-reserve` are strong reference designs.
10. **Use `omp-pi-install` as a fallback/reference, not as the first-line solution on OMP 18.x.**
11. **Test packaging, module loading, and runtime behavior separately.** Passing installation is necessary but not sufficient.
12. When you hit a missing Pi export, **search current OMP source/changelog before implementing a local shim**—the same compatibility class may already have been fixed.

---

# 36. Compact consumer checklist

```text
[ ] omp -v -> current release
[ ] inspect package.json: .omp // .pi
[ ] try: omp install <npm-pkg>
[ ] or:  omp install github:owner/repo
[ ] local test: omp -e ./entry-or-package
[ ] tail ~/.omp/logs/omp.$(date +%F).*.log
[ ] identify exact missing import/export
[ ] check current OMP compatibility shim/changelog
[ ] inspect Pi-specific skills/prompts/themes layout
[ ] patch only the specific incompatible API
```

# 37. Compact maintainer checklist

```text
[ ] keep host-neutral shared core
[ ] add src/pi.ts and src/omp.ts when host APIs differ
[ ] publish pi.extensions
[ ] publish omp.extensions
[ ] keep skills/prompts in conventional sibling dirs where possible
[ ] use optional host peer dependencies if needed
[ ] test local Pi entry
[ ] test local OMP entry
[ ] test npm/git installation on both
[ ] test current OMP compiled binary
[ ] avoid private host APIs unless adapter-isolated
[ ] document minimum tested Pi + OMP versions
```

---

## Appendix A — Primary URLs

### OMP

- <https://omp.sh/docs/extension-authoring>
- <https://omp.sh/docs/plugins>
- <https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md>
- <https://github.com/can1357/oh-my-pi/blob/main/docs/extension-loading.md>
- <https://github.com/can1357/oh-my-pi/blob/main/docs/plugin-manager-installer-plumbing.md>
- <https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/plugins/legacy-pi-compat.ts>
- <https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/legacy-pi-coding-agent-shim.ts>
- <https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/src/extensibility/plugins/types.ts>
- <https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/CHANGELOG.md>

### Pi

- <https://pi.dev/docs/latest/packages>
- <https://pi.dev/docs/latest/extensions>
- <https://github.com/earendil-works/pi>

### Compatibility issues

- <https://github.com/can1357/oh-my-pi/issues/433>
- <https://github.com/can1357/oh-my-pi/issues/441>
- <https://github.com/can1357/oh-my-pi/issues/2166>
- <https://github.com/can1357/oh-my-pi/issues/7094>
- <https://github.com/can1357/oh-my-pi/issues/6648>

### Examples / utilities

- <https://github.com/processmission/pi-usage-status>
- <https://github.com/mentalfl0w/omp-codex-reserve>
- <https://github.com/mentalfl0w/smart-approve>
- <https://github.com/rezhajulio/omp-model-profiles>
- <https://github.com/rayoplateado/omp-pi-install>
- <https://github.com/davebcn87/pi-autoresearch>

---

## Appendix B — Research notes on source freshness

This topic is unusually sensitive to version drift.

A GitHub issue from March–July 2026 may accurately describe the OMP version used by the reporter while being technically wrong for current OMP. During this research, current source was preferred over issue-opening statements, and final issue comments/changelog fixes were preferred over early workarounds.

When reusing this guide later:

1. re-check `omp -v`;
2. re-open `legacy-pi-compat.ts`;
3. re-open the current coding-agent compatibility shim;
4. re-check current Pi package scope/API;
5. verify any named missing export against the current release.

That procedure is more reliable than freezing a static list of “supported Pi plugins.”
