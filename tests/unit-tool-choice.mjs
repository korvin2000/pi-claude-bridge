#!/usr/bin/env node
/**
 * `toolChoice: "none"` is honoured by advertising no tools.
 *
 * A caller that asks for no tools — a summarizer, a judge, a title generator —
 * generally throws if one comes back. There is no tool_choice to forward through
 * Claude Code, so the only honest way to honour it is to hand the child an empty
 * tool list. resolveMcpTools is the seam: it is the single source of the MCP
 * server, the signature and both name maps, so no caller can route around it.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { __test } = await import("../src/index.js");

const context = (tools) => ({
	systemPrompt: "irrelevant",
	messages: [],
	tools,
});

const TOOLS = [
	{ name: "read", description: "Read a file", parameters: { type: "object", properties: {} } },
	{ name: "bash", description: "Run a command", parameters: { type: "object", properties: {} } },
];

describe("resolveMcpTools and toolChoice", () => {
	it("serves pi's tools when the caller expresses no preference", () => {
		const resolved = __test.resolveMcpTools(context(TOOLS), undefined, undefined);
		assert.deepEqual(resolved.mcpTools.map((tool) => tool.name), ["read", "bash"]);
		assert.equal(resolved.customToolNameToSdk.get("read"), "mcp__custom-tools__read");
	});

	it("serves them for an explicit auto", () => {
		assert.equal(__test.resolveMcpTools(context(TOOLS), undefined, "auto").mcpTools.length, 2);
	});

	it("advertises nothing for none, including the name maps", () => {
		const resolved = __test.resolveMcpTools(context(TOOLS), undefined, "none");
		assert.deepEqual(resolved.mcpTools, []);
		assert.equal(resolved.customToolNameToSdk.size, 0);
		assert.equal(resolved.customToolNameToPi.size, 0);
	});

	it("still excludes AskClaude from its own turn", () => {
		const resolved = __test.resolveMcpTools(
			context([...TOOLS, { name: "AskClaude", description: "ask", parameters: { type: "object", properties: {} } }]),
			"AskClaude",
			undefined,
		);
		assert.deepEqual(resolved.mcpTools.map((tool) => tool.name), ["read", "bash"]);
	});
});
