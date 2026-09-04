import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findLeakedToolCalls, leakedToolCallsEndingTurn } from "../src/leaked-tool-call.js";

const text = (t) => ({ type: "text", text: t });
const LEAK = '<invoke name="bash">\n<parameter name="command">npm test</parameter>\n</invoke>';

describe("findLeakedToolCalls", () => {
	it("names a tool call written as literal text", () => {
		assert.deepEqual(findLeakedToolCalls(`Running the suite now.\n${LEAK}`), ["bash"]);
	});

	// Built at runtime: the literal prefix does not survive being written into a
	// source file by an agent, and a stripped one silently retests the bare spelling.
	it("reads the namespaced spelling too", () => {
		const ns = `${"antml"}:`;
		const leak = `<${ns}invoke name="edit">x</${ns}invoke>`;
		assert.ok(leak.includes("antml:invoke"), "namespaced fixture lost its prefix");
		assert.deepEqual(findLeakedToolCalls(leak), ["edit"]);
	});

	it("reports each distinct tool once, in order", () => {
		const both = `${LEAK}\n<invoke name="read">a</invoke>\n<invoke name="bash">b</invoke>`;
		assert.deepEqual(findLeakedToolCalls(both), ["bash", "read"]);
	});

	it("ignores an unclosed mention, which is prose rather than a serialized call", () => {
		assert.deepEqual(findLeakedToolCalls('Call it with <invoke name="bash"> and a command.'), []);
	});

	it("ignores text with no invoke in it at all", () => {
		assert.deepEqual(findLeakedToolCalls("Here is a plain answer about </invoke> tags."), []);
	});
});

describe("leakedToolCallsEndingTurn", () => {
	it("fires when a turn stops on leaked text with no structured tool_use", () => {
		assert.deepEqual(leakedToolCallsEndingTurn([text(LEAK)], false, "stop"), ["bash"]);
		assert.deepEqual(leakedToolCallsEndingTurn([text(LEAK)], false, "end_turn"), ["bash"]);
		assert.deepEqual(leakedToolCallsEndingTurn([text(LEAK)], false, undefined), ["bash"]);
	});

	// A turn that really called a tool is not this bug: the work continues, and the
	// leaked text is at worst a stale draft beside a call that ran.
	it("stays quiet when the turn also made a real tool call", () => {
		assert.deepEqual(leakedToolCallsEndingTurn([text(LEAK)], true, "stop"), []);
	});

	// An errored or truncated turn already reports a cause; this would only add noise.
	it("stays quiet for a turn that stopped for some other reason", () => {
		assert.deepEqual(leakedToolCallsEndingTurn([text(LEAK)], false, "length"), []);
		assert.deepEqual(leakedToolCallsEndingTurn([text(LEAK)], false, "aborted"), []);
	});

	it("stays quiet on an ordinary answer", () => {
		assert.deepEqual(leakedToolCallsEndingTurn([text("All done — the tests pass.")], false, "stop"), []);
	});

	it("looks past thinking and tool blocks to the text ones", () => {
		const content = [{ type: "thinking", thinking: LEAK }, text(LEAK)];
		assert.deepEqual(leakedToolCallsEndingTurn(content, false, "stop"), ["bash"]);
		assert.deepEqual(leakedToolCallsEndingTurn([{ type: "thinking", thinking: LEAK }], false, "stop"), []);
	});

	it("tolerates an empty turn", () => {
		assert.deepEqual(leakedToolCallsEndingTurn([], false, "stop"), []);
	});
});
