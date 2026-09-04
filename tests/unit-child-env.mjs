/**
 * Every Claude Code subprocess the bridge spawns has to be told to keep its hands
 * off state pi owns. These are silent when missing: CC compacts or writes memory
 * on its own, nothing throws, and the damage shows up in the user's ~/.claude
 * rather than in a test.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { __test } = await import("../src/index.js");

describe("Claude Code child environment", () => {
	it("disables auto-compaction and claude.ai MCP servers", () => {
		assert.deepEqual(__test.CC_CHILD_ENV, {
			ENABLE_CLAUDEAI_MCP_SERVERS: "0",
			DISABLE_AUTO_COMPACT: "1",
		});
	});

	// The CC binary merges ANTHROPIC_BETAS into the anthropic-beta header it already
	// sends, so this is how a beta CC omits reaches the wire. Merging rather than
	// setting matters: a user debugging with their own beta must not lose it.
	it("adds the fine-grained tool-streaming beta without dropping the user's own", () => {
		assert.equal(__test.anthropicBetas({}), "fine-grained-tool-streaming-2025-05-14");
		assert.equal(__test.anthropicBetas({ ANTHROPIC_BETAS: "" }), "fine-grained-tool-streaming-2025-05-14");
		assert.equal(
			__test.anthropicBetas({ ANTHROPIC_BETAS: " some-other-beta , " }),
			"some-other-beta,fine-grained-tool-streaming-2025-05-14",
		);
		// Already named by the caller: kept once, in the caller's position.
		assert.equal(
			__test.anthropicBetas({ ANTHROPIC_BETAS: "fine-grained-tool-streaming-2025-05-14,x" }),
			"fine-grained-tool-streaming-2025-05-14,x",
		);
	});

	// Deliberately not asserted here: that every `query()` call site spreads the
	// constant. The only way to check that from a unit test is to grep src/index.ts,
	// which fails on innocent indirection (`env: childEnv`) and would have to be
	// taught about it — a brittle test that reads as coverage. The three sites
	// calling ccChildEnv() are the guard, and a fourth is a review question.
});
