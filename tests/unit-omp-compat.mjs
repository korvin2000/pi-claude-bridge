#!/usr/bin/env node

/**
 * Oh My Pi loads this extension through its legacy-Pi compatibility layer, which
 * remaps `@earendil-works/pi-*` to `@oh-my-pi/pi-*` and serves the package roots
 * from compat shims. Those shims do not re-export everything Pi's roots do, and
 * Bun checks named exports statically: one import of a symbol OMP's shim lacks
 * fails the whole extension at load, with `Export named 'x' not found` in
 * ~/.omp/logs and nothing registered.
 *
 * That failure is invisible from a Pi-only test run, so these guard it two ways:
 * by auditing what the OMP entry point's module graph actually imports by name,
 * and by pinning the pieces the OMP adapter has to reimplement because OMP has
 * no equivalent.
 *
 * The allowlist below is the research, written down. Each entry was checked
 * against oh-my-pi 18.1.10 — see the citation beside it — and anything added to
 * it later should be checked the same way rather than assumed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import { formatSkillList } from "../src/skills.js";
import { systemPromptText } from "../src/host.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SRC = join(ROOT, "src");

/** Host-package symbols OMP serves to a legacy extension, and where they come from.
 *
 *  `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` both resolve to
 *  compat shims (`legacy-pi-coding-agent-shim.ts`, `legacy-pi-ai-shim.ts`);
 *  `@earendil-works/pi-ai/compat` is remapped onto the pi-ai root, and
 *  `@earendil-works/pi-tui` onto the TUI shim, which re-exports the real package.
 *  Bare `typebox` is redirected to OMP's TypeBox facade. */
const AVAILABLE_ON_OMP = {
	"@earendil-works/pi-coding-agent": [
		"buildSessionContext", // coding-agent index -> ./session/session-context
		"getAgentDir", // coding-agent index -> @oh-my-pi/pi-utils
		"keyHint", // coding-agent index -> ./modes/components/keybinding-hints
		"CONFIG_DIR_NAME", // named re-export in legacy-pi-coding-agent-shim
		"compact", // named re-export in legacy-pi-coding-agent-shim
	],
	"@earendil-works/pi-ai": [
		"calculateCost", // legacy-pi-ai-shim -> @oh-my-pi/pi-catalog/models
		"StringEnum", // legacy-pi-ai-shim, implemented on the TypeBox facade
		"isRetryableAssistantError", // legacy-pi-ai-shim, ported from upstream pi-ai
	],
	"@earendil-works/pi-ai/compat": [
		"getModels", // legacy-pi-ai-shim, aliased to getBundledModels
	],
	"@earendil-works/pi-tui": [
		"Text", // legacy-pi-tui-shim -> @oh-my-pi/pi-tui
	],
	typebox: [
		"Type", // redirected to OMP's TypeBox compatibility facade
	],
};

/** Named exports Pi has and OMP does not. Importing one of these from the OMP
 *  graph is the exact regression this file exists to catch. */
const ABSENT_ON_OMP = [
	"formatSkillsForPrompt", // no OMP equivalent; src/skills.ts reimplements the format
	"generateBranchSummary", // lives in @oh-my-pi/pi-agent-core/compaction, not the shim
	"registerApiProvider", // renamed to registerCustomApi
	"unregisterApiProviders", // renamed to unregisterCustomApis
	"getApiProvider", // renamed to getCustomApi
];

const IMPORT = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;

/** Every import statement in `source`, as { clause, specifier }. */
function imports(source) {
	// Comments first: prose in these files names import specifiers too.
	const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
	return [...code.matchAll(IMPORT)].map(([, clause, specifier]) => ({ clause, specifier }));
}

/** The named value bindings in an import clause. `type` imports are erased before
 *  the module ever reaches Bun, so they are never checked against the shim. */
function namedValueImports(clause) {
	if (clause.startsWith("type ")) return [];
	const braces = clause.match(/\{([\s\S]*)\}/);
	if (!braces) return [];
	return braces[1]
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part && !part.startsWith("type "))
		.map((part) => part.split(/\s+as\s+/)[0].trim());
}

/** Files reachable from `entry` by relative import, entry included. */
function moduleGraph(entry) {
	const seen = new Set();
	const queue = [join(SRC, entry)];
	while (queue.length) {
		const file = queue.pop();
		if (seen.has(file)) continue;
		seen.add(file);
		for (const { specifier } of imports(readFileSync(file, "utf-8"))) {
			if (!specifier.startsWith(".")) continue;
			queue.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
		}
	}
	return [...seen].map((file) => file.replaceAll("\\", "/"));
}

describe("OMP module graph", () => {
	it("imports only host symbols OMP serves", () => {
		const offenders = [];
		for (const file of moduleGraph("omp.ts")) {
			for (const { clause, specifier } of imports(readFileSync(file, "utf-8"))) {
				const allowed = AVAILABLE_ON_OMP[specifier];
				if (!allowed) continue;
				for (const name of namedValueImports(clause)) {
					if (!allowed.includes(name)) offenders.push(`${file}: ${name} from ${specifier}`);
				}
			}
		}
		assert.deepEqual(offenders, [], "add a symbol to AVAILABLE_ON_OMP only after finding it in OMP's compat shims");
	});

	it("keeps Pi-only exports out of the graph entirely", () => {
		const found = [];
		for (const file of moduleGraph("omp.ts")) {
			for (const { clause, specifier } of imports(readFileSync(file, "utf-8"))) {
				if (!specifier.startsWith("@earendil-works/")) continue;
				for (const name of namedValueImports(clause)) {
					if (ABSENT_ON_OMP.includes(name)) found.push(`${file}: ${name}`);
				}
			}
		}
		assert.deepEqual(found, []);
	});

	it("keeps the two host adapters in separate graphs", () => {
		const omp = moduleGraph("omp.ts");
		const pi = moduleGraph("pi.ts");
		assert.ok(!omp.some((file) => file.endsWith("/host-pi.ts")), "host-pi.ts must not be reachable from the OMP entry");
		assert.ok(!pi.some((file) => file.endsWith("/host-omp.ts")), "host-omp.ts must not be reachable from the pi entry");
		assert.ok(omp.some((file) => file.endsWith("/index.ts")), "both entries share the same core");
		assert.ok(pi.some((file) => file.endsWith("/index.ts")));
	});

	it("declares an entry point for each host, and both exist", () => {
		const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
		assert.deepEqual(pkg.pi.extensions, ["./src/pi.ts"]);
		assert.deepEqual(pkg.omp.extensions, ["./src/omp.ts"]);
		for (const entry of [...pkg.pi.extensions, ...pkg.omp.extensions]) {
			assert.ok(readFileSync(join(ROOT, entry), "utf-8"));
		}
	});
});

describe("skill listing without Pi's formatter", () => {
	const skill = (name, description = `${name} description`) => ({
		name,
		description,
		filePath: `/skills/${name}/SKILL.md`,
		baseDir: `/skills/${name}`,
		sourceInfo: { source: "test", scope: "temporary", origin: "top-level" },
		disableModelInvocation: false,
	});

	it("reproduces Pi's block byte for byte, so both hosts send Claude Code the same text", () => {
		const skills = [skill("browser"), skill("release-notes", 'read <this> & "that"')];
		assert.equal(formatSkillList(skills), formatSkillsForPrompt(skills));
	});

	it("renders nothing for an empty list, like Pi", () => {
		assert.equal(formatSkillList([]), "");
		assert.equal(formatSkillList([]), formatSkillsForPrompt([]));
	});
});

describe("OMP tool-renderer arguments", () => {
	// `registerTool`'s renderCall is (args, theme, context) on pi but
	// (args, options, theme) on OMP — verified against oh-my-pi 18.1.10
	// `extensibility/extensions/types.ts`. Reading the wrong slot is not a type
	// error; it surfaces as `theme.fg is not a function` the first time AskClaude
	// renders, which no Pi-side test would ever reach. The OMP adapter cannot be
	// imported here, so its answer is read out of the source it declares.
	it("takes the theme from the third argument, not the second", () => {
		const source = readFileSync(join(SRC, "host-omp.ts"), "utf-8");
		const body = source.slice(source.indexOf("toolRenderTheme("));
		assert.match(body.slice(0, body.indexOf("},")), /return rest\[1\] as Theme;/);
	});
});

describe("systemPromptText", () => {
	it("passes a Pi prompt through unchanged", () => {
		assert.equal(systemPromptText("You are pi."), "You are pi.");
	});

	it("joins OMP's segments the same way wherever it is read", () => {
		assert.equal(systemPromptText(["a", "b"]), "a\n\nb");
		// The provider's Context and ctx.getSystemPrompt() must collapse to the
		// same key, or a recorded capture never resolves and every turn falls
		// through to a verbatim side request.
		assert.equal(systemPromptText(["a", "b"]), systemPromptText(["a", "", "b"]));
	});

	it("treats an empty prompt as absent on both hosts", () => {
		assert.equal(systemPromptText(""), undefined);
		assert.equal(systemPromptText([]), undefined);
		assert.equal(systemPromptText(["", ""]), undefined);
		assert.equal(systemPromptText(undefined), undefined);
	});
});
