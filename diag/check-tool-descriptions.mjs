#!/usr/bin/env node
/**
 * Render every tool-description profile and print the budget table. This is the
 * authoring loop for src/tool-descriptions/: edit a `condensed.md`, re-run, read
 * the new number.
 *
 * Two corpora, and the difference between them is the point:
 *
 *   - Every variant's shipped `original.md`, always. This exercises the modes
 *     this machine never renders — `edit` picks one of five documents from a
 *     setting, so four of them are only ever tested here.
 *   - A directory of live captures, when given or when the bridge has written
 *     one. That is the reality check: OMP assembles descriptions at runtime, so
 *     a reference file can agree with the repo and still disagree with the
 *     session. A capture that no variant matches is exactly the drift the
 *     runtime would report as stale.
 *
 * Usage:  node diag/check-tool-descriptions.mjs [capture-dir]
 *
 * Captures come from setting `toolDescriptions.capture` in claude-bridge.json
 * and running one turn; see src/tool-descriptions/README.md.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	CC_TOOL_DESCRIPTION_CAP,
	configureToolDescriptions,
	loadedProfiles,
	referenceOriginal,
	renderForTest,
} from "../src/tool-descriptions.ts";

const captureDir = process.argv[2]
	?? join(process.env.PI_AGENT_DIR ?? join(homedir(), ".pi", "agent"), "claude-bridge-tool-descriptions");

const captures = new Map(
	existsSync(captureDir)
		? readdirSync(captureDir).filter((f) => f.endsWith(".md")).map((f) => [f.slice(0, -3), readFileSync(join(captureDir, f), "utf-8")])
		: [],
);

configureToolDescriptions({});
const profiles = loadedProfiles();

console.log(`cap ${CC_TOOL_DESCRIPTION_CAP} · ${profiles.size} profiles · ${captures.size ? `${captures.size} captures from ${captureDir}` : "no live captures"}\n`);

let failures = 0;
let tightest = Infinity;

function row(label, original, outcome) {
	if (outcome.kind !== "condensed") {
		failures++;
		console.log(`  ${label.padEnd(26)} ${String(original.length).padStart(5)}   ${outcome.kind.toUpperCase()}: ${outcome.reason ?? ""}`);
		return;
	}
	const spare = CC_TOOL_DESCRIPTION_CAP - outcome.to;
	tightest = Math.min(tightest, spare);
	const trimmed = outcome.trimmed.length > 0 ? `  trimmed ${outcome.trimmed.join("+")}` : "";
	console.log(
		`  ${label.padEnd(26)} ${String(original.length).padStart(5)} → ${String(outcome.to).padStart(4)}`
		+ `  ${String(spare).padStart(4)} spare  −${String(Math.round((1 - outcome.to / original.length) * 100)).padStart(2)}%${trimmed}`,
	);
}

for (const [tool, profile] of [...profiles].sort()) {
	console.log(tool);
	for (const variant of profile.variants) {
		const reference = referenceOriginal(profile, variant);
		if (reference === null) {
			console.log(`  ${variant.id.padEnd(26)}   —   no reference original shipped`);
			failures++;
			continue;
		}
		row(variant.id, reference, renderForTest(profile, reference));
	}
	const live = captures.get(tool);
	if (live !== undefined) row("live capture", live, renderForTest(profile, live));
}

// Over-cap descriptions nothing claims are why the size warning still exists;
// naming them here keeps both halves of the problem in one view.
const unprofiled = [...captures].filter(([tool, text]) => !profiles.has(tool) && text.length > CC_TOOL_DESCRIPTION_CAP);
if (unprofiled.length > 0) {
	console.log(`\nover cap, no profile — Claude Code truncates these:`);
	for (const [tool, text] of unprofiled) console.log(`  ${tool.padEnd(26)} ${String(text.length).padStart(5)}`);
}

console.log(`\ntightest headroom: ${tightest === Infinity ? "n/a" : tightest} chars`);
process.exit(failures > 0 ? 1 : 0);
