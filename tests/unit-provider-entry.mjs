#!/usr/bin/env node

/**
 * Which lane a call reaching the registered provider belongs on.
 *
 * Not everything handed to a registered `streamSimple` is a conversation turn. An
 * extension can pull this provider's handle out of pi's model runtime
 * (`ctx.modelRegistry.getRegisteredProviderConfig`) and drive it with a prompt of
 * its own — a permission reviewer, a judge, a summarizer. Those used to land on
 * the conversation lane, where prompt-capture resolution rightly throws on a
 * prompt pi never assembled, and the turn failed outright.
 *
 * The discriminator is the main lane's own: a conversation turn's system prompt
 * resolves (or derives) against pi's captured assembly; a foreign one-shot's does
 * not. Narrowed to a single-user-message context so a resumed conversation whose
 * prompt has drifted still derives and keeps its shared session.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { default: activate } = await import("../src/pi.js");
const { __test } = await import("../src/index.js");

function activateWithMockPi() {
	const handlers = new Map();
	activate({ on: (event, handler) => handlers.set(event, handler), registerProvider: () => {}, registerCommand: () => {} });
	return handlers;
}

const PI_PROMPT = "You are pi, a coding agent.\n# Tools\n- read: Read a file\n";
const user = (content) => ({ role: "user", content, timestamp: Date.now() });

describe("isForeignOneShot", () => {
	it("sends a one-shot with a prompt pi never assembled to the side lane", () => {
		activateWithMockPi();
		assert.equal(
			__test.isForeignOneShot({
				systemPrompt: "Score this diff 1-10 and reply with the number only.",
				messages: [user("diff --git a/x b/x")],
			}),
			true,
		);
	});

	it("keeps a real first turn on the conversation lane", async () => {
		const handlers = activateWithMockPi();
		await handlers.get("before_agent_start")({ systemPrompt: PI_PROMPT, systemPromptOptions: { cwd: process.cwd() } });
		assert.equal(__test.isForeignOneShot({ systemPrompt: PI_PROMPT, messages: [user("hello")] }), false);
	});

	it("keeps a prompt already served on the side lane there for its later turns", () => {
		// On Oh My Pi every call for a bridge model arrives through one dispatch
		// point, so an extension agent loop's second request — user, assistant,
		// toolResult — reaches here too. Without the memory it would fall through
		// to the main lane and throw on the same prompt that was foreign a moment
		// earlier, breaking any side request that uses a tool.
		activateWithMockPi();
		const foreign = "Take notes on what you are told. Call record_note.";
		__test.sidePrompts.clear();
		__test.rememberSidePrompt(foreign);
		assert.equal(
			__test.isForeignOneShot({
				systemPrompt: foreign,
				messages: [user("remember this"), { role: "assistant", content: [{ type: "text", text: "ok" }] }, user("and this")],
			}),
			true,
		);
		__test.sidePrompts.clear();
	});

	it("keeps a multi-message conversation on the main lane even with a drifted prompt", () => {
		activateWithMockPi();
		assert.equal(
			__test.isForeignOneShot({
				systemPrompt: "a prompt no capture will ever match",
				messages: [user("first"), { role: "assistant", content: [{ type: "text", text: "ok" }] }, user("second")],
			}),
			false,
			"a resumed conversation must keep its shared session rather than being served as a side request",
		);
	});

	it("leaves a context with no system prompt alone", () => {
		activateWithMockPi();
		assert.equal(__test.isForeignOneShot({ systemPrompt: undefined, messages: [user("hi")] }), false);
	});
});
