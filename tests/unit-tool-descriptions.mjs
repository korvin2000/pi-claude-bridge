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
		assert.deepEqual(names, ["edit", "eval", "hub", "read", "task", "todo"]);
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
