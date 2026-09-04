#!/usr/bin/env node

/**
 * agent_start records the fully-widened system prompt.
 *
 * An MCP server's tool descriptions merge into pi's system prompt only once that
 * server connects — which is after `before_agent_start`. So `event.systemPrompt`
 * there is the pre-widen text, while the prompt the provider is actually handed
 * (and that pi-subagents embeds verbatim into a child via `ctx.getSystemPrompt()`
 * at dispatch) is the widened one. With only the pre-widen key on file, a
 * subagent's turn resolves against nothing, falls through to a verbatim side
 * request, and ships pi's harness to Claude Code — which trips the server's
 * plan-eligibility check as a 400 "out of extra usage".
 *
 * These pin that agent_start records `ctx.getSystemPrompt()`, so the widened
 * prompt resolves exactly, and that the options captured at before_agent_start
 * still ride along with it.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { default: activate, __test } = await import("../src/index.js");

function activateWithMockPi() {
	const handlers = new Map();
	activate({ on: (event, handler) => handlers.set(event, handler), registerProvider: () => {}, registerCommand: () => {} });
	return handlers;
}

const PRE_WIDEN = "You are pi.\n# Tools\n- read: Read a file\n\npi packages (docs/packages.md)";
// The same prefix, then the MCP tool descriptions that only appear post-connect.
const WIDENED = "You are pi.\n# Tools\n- read: Read a file\n- Agent: Launch a subagent, with a description long enough to matter\n\npi packages (docs/packages.md)";

describe("agent_start widened-prompt capture", () => {
	it("records ctx.getSystemPrompt() so the widened prompt itself resolves", () => {
		const handlers = activateWithMockPi();
		handlers.get("before_agent_start")({ systemPrompt: PRE_WIDEN, systemPromptOptions: { cwd: process.cwd() } });

		handlers.get("agent_start")({}, { getSystemPrompt: () => WIDENED });
		const capture = __test.promptCaptures.resolve(WIDENED);
		assert.ok(capture, "the widened prompt must be an exact key after agent_start");
		assert.equal(capture.assembledPrompt, WIDENED);
	});

	it("carries the options from before_agent_start onto the widened recording", () => {
		const handlers = activateWithMockPi();
		const contextFiles = [{ path: "AGENTS.md", content: "house rules" }];
		handlers.get("before_agent_start")({
			systemPrompt: PRE_WIDEN,
			systemPromptOptions: { cwd: process.cwd(), contextFiles, appendSystemPrompt: "be brief" },
		});
		handlers.get("agent_start")({}, { getSystemPrompt: () => WIDENED });

		const capture = __test.promptCaptures.resolve(WIDENED);
		assert.deepEqual(capture.contextFiles, contextFiles);
		assert.equal(capture.append, "be brief");
	});

	it("records nothing when the host has no prompt to report", () => {
		const handlers = activateWithMockPi();
		handlers.get("before_agent_start")({ systemPrompt: PRE_WIDEN, systemPromptOptions: { cwd: process.cwd() } });
		handlers.get("agent_start")({}, { getSystemPrompt: () => "" });
		assert.equal(__test.promptCaptures.resolve(""), undefined);
	});
});
