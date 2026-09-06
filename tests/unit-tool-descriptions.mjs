/**
 * The contract for src/tool-descriptions.ts: every shipped profile fits Claude
 * Code's cap, nothing is silently invented, and a description the profile no
 * longer matches falls back to the original rather than to a guess.
 *
 * The corpus is each variant's own `original.md`. That is deliberate — `edit`
 * chooses one of five documents from a setting, so four of its variants are
 * exercised nowhere else, and a profile that is never rendered is the one that
 * rots. What these fixtures cannot prove is that they still match what OMP
 * emits; only a live capture does that, which is what the `capture` setting and
 * diag/check-tool-descriptions.mjs are for.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CC_TOOL_DESCRIPTION_CAP,
	captureLiveDescriptions,
	condenseDescription,
	configureToolDescriptions,
	descriptionFor,
	loadedProfiles,
	referenceOriginal,
	renderForTest,
	reportDescriptions,
	structuralCondense,
} from "../src/tool-descriptions.js";

const scratch = [];
function tempDir(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	scratch.push(dir);
	return dir;
}
process.on("exit", () => {
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

describe("shipped profiles", () => {
	before(() => configureToolDescriptions({}));

	it("cover the tools the bridge warns about", () => {
		const names = [...loadedProfiles().keys()].sort();
		assert.deepEqual(names, ["ast_edit", "edit", "eval", "hub", "read", "task", "todo"]);
	});

	it("render every variant under the cap, against its own reference original", () => {
		for (const [tool, profile] of loadedProfiles()) {
			for (const variant of profile.variants) {
				const original = referenceOriginal(profile, variant);
				assert.ok(original, `${tool}/${variant.id}: no reference original shipped`);
				assert.ok(
					original.length > CC_TOOL_DESCRIPTION_CAP,
					`${tool}/${variant.id}: reference is ${original.length} chars, already under the cap — nothing to condense`,
				);
				const outcome = renderForTest(profile, original);
				assert.equal(outcome.kind, "condensed", `${tool}/${variant.id}: ${outcome.reason ?? outcome.kind}`);
				assert.equal(outcome.variant, variant.id, `${tool}/${variant.id}: matched ${outcome.variant} instead`);
				assert.ok(
					outcome.to <= CC_TOOL_DESCRIPTION_CAP,
					`${tool}/${variant.id}: ${outcome.to} chars, over the ${CC_TOOL_DESCRIPTION_CAP} cap`,
				);
			}
		}
	});

	// A template that only fits because a slot happened to be small is a template
	// that breaks on the first session with a longer agent roster. Every slot
	// empty is the worst case for the static prose and the best case for the
	// budget, so it is the invariant the runtime can never violate.
	it("fit with every slot empty, so an elastic slot always has room to give", () => {
		for (const [tool, profile] of loadedProfiles()) {
			for (const variant of profile.variants) {
				// No markers, so no slot resolves and nothing splices.
				const bare = variant.requires.join("\n") + "\n" + "x".repeat(CC_TOOL_DESCRIPTION_CAP);
				const outcome = renderForTest(profile, bare);
				assert.equal(outcome.kind, "condensed", `${tool}/${variant.id}: ${outcome.reason ?? outcome.kind}`);
				assert.ok(
					outcome.to <= CC_TOOL_DESCRIPTION_CAP,
					`${tool}/${variant.id}: static prose alone is ${outcome.to} chars`,
				);
			}
		}
	});

	it("leave no unresolved slot markers in the rendered text", () => {
		for (const [tool, profile] of loadedProfiles()) {
			for (const variant of profile.variants) {
				const outcome = renderForTest(profile, referenceOriginal(profile, variant));
				assert.doesNotMatch(outcome.text, /\{\{/, `${tool}/${variant.id} left a slot marker in the output`);
			}
		}
	});

	// The point of splicing rather than freezing: the project's own agent names
	// and the kernel API for the languages this session enabled have to survive.
	it("splice live content verbatim", () => {
		const profile = loadedProfiles().get("task");
		const original = referenceOriginal(profile, profile.variants[0]).replace(
			"### scout (READ-ONLY)",
			"### housetrained (READ-ONLY)",
		);
		const outcome = renderForTest(profile, original);
		assert.match(outcome.text, /### housetrained \(READ-ONLY\)/);
	});
});

// Regression, found on a live capture rather than a fixture: `eval` renders a
// `preludeDocumentation` section mid-description — the `browser` prelude on the
// machine this was caught on — and that section carries its own <critical> and
// <examples>. Taking the first match spliced the browser's rule into `eval` in
// place of its own, which is the exact failure mode this module exists to
// prevent: not a visible truncation, but confident documentation for the wrong
// thing. The extractors take the LAST match; this pins that.
describe("duplicate blocks", () => {
	before(() => configureToolDescriptions({}));

	it("splice the tool's own block, not one injected by a prelude", () => {
		const profile = loadedProfiles().get("eval");
		const variant = profile.variants.find((v) => v.id === "default");
		const original = referenceOriginal(profile, variant);
		const blocks = [...original.matchAll(/^<critical>\n([\s\S]*?)\n<\/critical>$/gm)];
		assert.ok(blocks.length >= 2, `fixture must keep both <critical> blocks, has ${blocks.length}`);

		const outcome = renderForTest(profile, original);
		assert.match(outcome.text, /Prior top-level names survive into the next cell/);
		// The injected block's opening words must not appear in eval's description.
		assert.doesNotMatch(outcome.text, /Static content\? Use `read`/);
	});

	// `requires` checks the description; `expect` checks the SPAN. Only the second
	// catches the shape of the real bug, where the variant matched and the budget
	// fitted and the spliced block was still the wrong one. Driven through `todo`,
	// whose `requires` markers all sit outside <critical>, so this exercises the
	// span check rather than falling out at variant matching.
	it("refuse the condensation when a slot resolves to the wrong span", () => {
		const profile = loadedProfiles().get("todo");
		const original = referenceOriginal(profile, profile.variants[0])
			.replace(/<critical>\n[\s\S]*?<\/critical>/, "<critical>\nSomething else entirely.\n</critical>");
		const outcome = renderForTest(profile, original);
		assert.equal(outcome.kind, "stale", "a wrong span must fall back, not ship");
		assert.match(outcome.reason, /slot critical resolved to a span without/);
	});

	it("take the appended <examples> block, which pi always writes last", () => {
		const profile = loadedProfiles().get("todo");
		const original = referenceOriginal(profile, profile.variants[0])
			.replace("## Operations", "<examples>\n<example>\ninjected(bogus=1)\n</example>\n</examples>\n\n## Operations");
		const span = renderForTest(profile, original);
		assert.equal(span.kind, "condensed");
		assert.doesNotMatch(span.text, /injected\(bogus=1\)/);
	});
});

describe("verification", () => {
	before(() => configureToolDescriptions({}));

	it("forwards the original when no variant matches", () => {
		const profile = loadedProfiles().get("read");
		const outcome = renderForTest(profile, "Read a file.".repeat(400));
		assert.equal(outcome.kind, "stale");
		assert.match(outcome.reason, /no variant matches/);
	});

	it("leaves a description under the cap untouched", () => {
		const outcome = condenseDescription({ name: "read", description: "short" });
		assert.equal(outcome.kind, "unchanged");
		assert.equal(descriptionFor({ name: "read", description: "short" }), "short");
	});

	it("reports an oversized tool with no profile rather than dropping it", () => {
		const tool = { name: "computer", description: "x".repeat(4758) };
		const report = reportDescriptions([tool]);
		assert.deepEqual(report.unprofiled, [{ name: "computer", length: 4758 }]);
		assert.equal(descriptionFor(tool), tool.description);
	});

	it("stops condensing when the setting is off, and says the tool is unprofiled", () => {
		const profile = loadedProfiles().get("read");
		const original = referenceOriginal(profile, profile.variants[0]);
		configureToolDescriptions({ condense: false });
		const tool = { name: "read", description: original };
		assert.equal(descriptionFor(tool), original);
		assert.equal(reportDescriptions([tool]).unprofiled.length, 1);
		configureToolDescriptions({});
	});
});

// The answer to "will this survive the next Oh My Pi release": a condenser that
// reads only the shape of a description, never its wording. It is what runs when
// no profile matches, so an unprofiled tool and an outgrown profile both land on
// something better than a severed prefix.
describe("shape-only fallback", () => {
	before(() => configureToolDescriptions({}));

	it("keeps the lede and the closing rules, and fits, for every shipped reference", () => {
		for (const [tool, profile] of loadedProfiles()) {
			for (const variant of profile.variants) {
				const original = referenceOriginal(profile, variant);
				const generic = structuralCondense(original);
				assert.ok(generic, `${tool}/${variant.id}: fallback produced nothing`);
				assert.ok(
					generic.text.length <= CC_TOOL_DESCRIPTION_CAP,
					`${tool}/${variant.id}: fallback returned ${generic.text.length} chars`,
				);
				assert.ok(original.startsWith(generic.text.slice(0, 40)), `${tool}/${variant.id}: lede not kept`);
				// The tool's own closing block is the thing truncation always destroyed.
				const critical = [...original.matchAll(/^<critical>\n[\s\S]*?\n<\/critical>$/gm)].at(-1);
				if (critical) assert.ok(generic.text.includes(critical[0]), `${tool}/${variant.id}: <critical> dropped`);
			}
		}
	});

	it("never invents text — every kept line comes from the original", () => {
		const profile = loadedProfiles().get("eval");
		const original = referenceOriginal(profile, profile.variants.find((v) => v.id === "default"));
		for (const line of structuralCondense(original).text.split("\n")) {
			if (line.trim() === "" || line.startsWith("…")) continue;
			assert.ok(original.includes(line), `fallback emitted a line absent from the original: ${line.slice(0, 60)}`);
		}
	});

	it("serves an unprofiled oversized tool instead of letting it be truncated", () => {
		const profile = loadedProfiles().get("hub");
		const original = referenceOriginal(profile, profile.variants[0]);
		const tool = { name: "some-future-omp-tool", description: original };
		const served = descriptionFor(tool);
		assert.ok(served.length <= CC_TOOL_DESCRIPTION_CAP, `served ${served.length} chars`);
		assert.notEqual(served, original);
		assert.equal(reportDescriptions([tool]).generic.length, 1);
	});

	it("stands down when the fallback is switched off", () => {
		const profile = loadedProfiles().get("hub");
		const original = referenceOriginal(profile, profile.variants[0]);
		configureToolDescriptions({ fallback: false });
		assert.equal(descriptionFor({ name: "some-future-omp-tool", description: original }), original);
		configureToolDescriptions({});
	});
});

describe("overrides", () => {
	it("replace one shipped profile and leave the rest alone", () => {
		const dir = tempDir("claude-bridge-td-override-");
		mkdirSync(join(dir, "read"));
		writeFileSync(
			join(dir, "read", "profile.json"),
			JSON.stringify({ variants: [{ id: "mine", requires: ["## Selectors"], template: "condensed.md" }] }),
		);
		writeFileSync(join(dir, "read", "condensed.md"), "Reads things.");

		configureToolDescriptions({ overridesDir: dir });
		const profiles = loadedProfiles();
		assert.equal(profiles.get("read").source, "override");
		assert.equal(profiles.get("eval").source, "builtin");

		const shipped = loadedProfiles().get("todo");
		const readOriginal = "## Selectors\n" + "x".repeat(CC_TOOL_DESCRIPTION_CAP);
		assert.equal(descriptionFor({ name: "read", description: readOriginal }), "Reads things.");
		assert.ok(shipped, "overriding one tool must not unload the others");
		configureToolDescriptions({});
	});

	it("ignore a profile that does not parse instead of failing the session", () => {
		const dir = tempDir("claude-bridge-td-broken-");
		mkdirSync(join(dir, "read"));
		writeFileSync(join(dir, "read", "profile.json"), "{ not json");

		configureToolDescriptions({ overridesDir: dir });
		// Falls back to the shipped profile, which still condenses.
		assert.equal(loadedProfiles().get("read").source, "builtin");
		configureToolDescriptions({});
	});
});

// The assertion that matters most: nothing above proves the condensation is what
// Claude Code is actually served. buildMcpServers is the real path — index.ts
// hands its output straight to the Agent SDK as `mcpServers` — so drive that.
describe("the MCP wire", () => {
	it("advertises the condensed text, not pi's original", async () => {
		configureToolDescriptions({});
		const { __test } = await import("../src/index.js");
		const profile = loadedProfiles().get("read");
		const original = referenceOriginal(profile, profile.variants[0]);

		const queryCtx = { pendingResults: new Map(), pendingToolCalls: new Map() };
		const servers = __test.buildMcpServers(
			[{ name: "read", description: original, parameters: { type: "object", properties: {} } }],
			queryCtx,
		);
		const listed = await listTools(Object.values(servers)[0].instance);

		assert.equal(listed.length, 1);
		assert.ok(listed[0].description.length <= CC_TOOL_DESCRIPTION_CAP, `served ${listed[0].description.length} chars`);
		assert.notEqual(listed[0].description, original);
		// The spliced <critical> block is the payload truncation was destroying.
		assert.match(listed[0].description, /NEVER guess `\.\.`/);
	});
});

// Same shape as tests/unit-mcp-server.mjs: the SDK connects a transport and
// speaks raw JSON-RPC, so read the wire rather than the server's internals.
async function listTools(server) {
	let reply;
	const transport = {
		start: async () => {},
		close: async () => {},
		send: async (message) => { reply = message; },
	};
	await server.connect(transport);
	transport.onmessage({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
	await new Promise((resolve) => setTimeout(resolve, 0));
	return reply.result.tools;
}

describe("capture", () => {
	it("writes one file per described tool, and nothing without a directory", () => {
		configureToolDescriptions({});
		assert.equal(captureLiveDescriptions([{ name: "read", description: "x" }]), null);

		const dir = join(tempDir("claude-bridge-td-capture-"), "nested");
		configureToolDescriptions({ captureDir: dir });
		const written = captureLiveDescriptions([
			{ name: "read", description: "live read text" },
			{ name: "nodesc" },
		]);
		assert.equal(written, dir);
		assert.equal(readFileSync(join(dir, "read.md"), "utf-8"), "live read text");
		assert.equal(existsSync(join(dir, "nodesc.md")), false, "a tool with no description must not produce an empty capture");
		configureToolDescriptions({});
	});
});
