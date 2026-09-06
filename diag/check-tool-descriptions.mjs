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

// The bridge writes captures under the RUNNING host's agent dir — `~/.pi/agent`
// on pi, `~/.omp/agent` on Oh My Pi — which this script cannot know, because it
// runs in plain node where `getAgentDir()` would always answer for pi. So try
// every candidate rather than guessing one and reporting "no captures" from the
// wrong directory, which is indistinguishable from capture being switched off.
const CAPTURE_SUBDIR = "claude-bridge-tool-descriptions";
const candidates = process.argv[2]
	? [process.argv[2]]
	: [
		process.env.PI_CODING_AGENT_DIR && join(process.env.PI_CODING_AGENT_DIR, CAPTURE_SUBDIR),
		join(homedir(), ".omp", "agent", CAPTURE_SUBDIR),
		join(homedir(), ".pi", "agent", CAPTURE_SUBDIR),
	].filter(Boolean);

const captureDir = candidates.find((dir) => existsSync(dir));
const captures = new Map(
	captureDir
		? readdirSync(captureDir).filter((f) => f.endsWith(".md")).map((f) => [f.slice(0, -3), readFileSync(join(captureDir, f), "utf-8")])
		: [],
);

configureToolDescriptions({});
const profiles = loadedProfiles();

console.log(`cap ${CC_TOOL_DESCRIPTION_CAP} · ${profiles.size} profiles · ${captures.size ? `${captures.size} captures from ${captureDir}` : "no live captures"}\n`);

// Without captures this run proves only that the profiles agree with the
// reference files shipped beside them — which is a regression check, not
// evidence about the session. Say so, and say exactly how to get the evidence.
if (captures.size === 0) {
	console.log("Reference originals only. To check against what your session really renders:");
	console.log(`  1. add "toolDescriptions": { "capture": true } to claude-bridge.json`);
	console.log("  2. run one turn on a bridge model");
	console.log("  3. re-run this\n");
	console.log(`Looked in: ${candidates.join(", ")}\n`);
}

let failures = 0;
let tightest = Infinity;
let tightestName = "";

/** Room the STATIC prose has left, which is the number that predicts breakage.
 *
 *  The rendered length does not: a profile with a healthy elastic slot fills the
 *  budget to the last character on purpose, so "0 spare" there means the slot did
 *  its job. What actually breaks a profile is its own prose growing past the cap
 *  — or OMP's, which arrives as a longer span the slot then has to absorb. So
 *  measure the render with every slot empty. */
function staticHeadroom(profile, variant) {
	const bare = `${variant.requires.join("\n")}\n${"x".repeat(CC_TOOL_DESCRIPTION_CAP)}`;
	const outcome = renderForTest(profile, bare);
	return outcome.kind === "condensed" ? CC_TOOL_DESCRIPTION_CAP - outcome.to : null;
}

function row(label, original, outcome, headroom) {
	if (outcome.kind !== "condensed") {
		failures++;
		console.log(`  ${label.padEnd(26)} ${String(original.length).padStart(5)}   ${outcome.kind.toUpperCase()}: ${outcome.reason ?? ""}`);
		return;
	}
	const trimmed = outcome.trimmed.length > 0 ? `  trimmed ${outcome.trimmed.join("+")}` : "";
	const room = headroom === undefined || headroom === null ? "" : `  static room ${String(headroom).padStart(4)}`;
	console.log(
		`  ${label.padEnd(26)} ${String(original.length).padStart(5)} → ${String(outcome.to).padStart(4)}`
		+ `  −${String(Math.round((1 - outcome.to / original.length) * 100)).padStart(2)}%${room}${trimmed}`,
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
		const headroom = staticHeadroom(profile, variant);
		if (headroom !== null && headroom < tightest) {
			tightest = headroom;
			tightestName = `${tool}/${variant.id}`;
		}
		row(variant.id, reference, renderForTest(profile, reference), headroom);
	}
	const live = captures.get(tool);
	if (live !== undefined) {
		row("live capture", live, renderForTest(profile, live));
		// A repeated tag means a slot has more than one candidate, and the
		// extractors resolve that silently by taking the last. Silent is how the
		// browser prelude's <critical> ended up spliced into `eval`, so say it out
		// loud here — this is the view an author reads before shipping a profile.
		for (const [tag, n] of duplicateTags(live)) {
			const claimed = Object.entries(profile.slots ?? {}).some(([, s]) => s.tag === tag || (s.from === "examples" && tag === "examples"));
			if (claimed) console.log(`    note: <${tag}> appears ${n}× — took the last`);
		}
	}
}

/** Tags that close more than once in one description. */
function duplicateTags(text) {
	const counts = new Map();
	for (const match of text.matchAll(/^<([\w-]+)>\n[\s\S]*?\n<\/\1>$/gm)) {
		counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
	}
	return [...counts].filter(([, n]) => n > 1);
}

// Over-cap descriptions nothing claims are why the size warning still exists;
// naming them here keeps both halves of the problem in one view.
const unprofiled = [...captures].filter(([tool, text]) => !profiles.has(tool) && text.length > CC_TOOL_DESCRIPTION_CAP);
if (unprofiled.length > 0) {
	console.log(`\nover cap, no profile — Claude Code truncates these:`);
	for (const [tool, text] of unprofiled) console.log(`  ${tool.padEnd(26)} ${String(text.length).padStart(5)}`);
}

console.log(`\ntightest static room: ${tightest === Infinity ? "n/a" : `${tightest} chars (${tightestName})`} — this is what an OMP upgrade eats into`);
process.exit(failures > 0 ? 1 : 0);
