#!/usr/bin/env node
// Unit tests for carrying CC attachments across a rebuild (attachments.ts).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectCarriedAttachments, placeCarriedAttachments } from "../src/attachments.js";

const user = (uuid, text) => ({ type: "user", uuid, message: { role: "user", content: [{ type: "text", text }] } });
const toolResultUser = (uuid) => ({
	type: "user", uuid,
	message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
});
const attach = (uuid, parentUuid, type, filename) => ({
	type: "attachment", uuid, parentUuid, attachment: { type, filename },
});

describe("collectCarriedAttachments", () => {
	it("keeps content-bearing kinds and drops the ones CC regenerates", () => {
		const carried = collectCarriedAttachments([
			user("u1", "review @a.js"),
			attach("a1", "u1", "file", "/a.js"),
			attach("a2", "u1", "skill_listing"),
			attach("a3", "u1", "task_reminder"),
			attach("a4", "u1", "edited_text_file", "/b.js"),
		]);
		assert.deepEqual(carried.map((c) => c.attachment.filename), ["/a.js", "/b.js"]);
		assert.deepEqual(carried.map((c) => c.anchor), ["prompt", "prompt"]);
	});

	it("anchors an attachment on a tool-result record by its tool_use_id", () => {
		const carried = collectCarriedAttachments([
			user("u1", "go"),
			toolResultUser("u2"),
			attach("a1", "u2", "edited_text_file", "/b.js"),
		]);
		assert.deepEqual(carried, [
			{ attachment: { type: "edited_text_file", filename: "/b.js" }, anchor: "toolResult", toolUseId: "t1" },
		]);
	});

	it("anchors nothing on a record answering several calls at once", () => {
		const parallel = {
			type: "user", uuid: "u2",
			message: { role: "user", content: [
				{ type: "tool_result", tool_use_id: "t1", content: "ok" },
				{ type: "tool_result", tool_use_id: "t2", content: "ok" },
			] },
		};
		const carried = collectCarriedAttachments([user("u1", "go"), parallel, attach("a1", "u2", "edited_text_file", "/b.js")]);
		assert.equal(carried.length, 0);
	});

	it("counts ordinals over prompts only, skipping tool-result user records", () => {
		const carried = collectCarriedAttachments([
			user("u1", "first"),
			toolResultUser("u2"),
			user("u3", "review @a.js"),
			attach("a1", "u3", "file", "/a.js"),
		]);
		assert.equal(carried[0].userOrdinal, 1);
		assert.equal(carried[0].parentText, "review @a.js");
	});

	it("ignores an attachment whose parent is not a prompt", () => {
		const carried = collectCarriedAttachments([
			user("u1", "first"),
			attach("a1", "missing-uuid", "file", "/a.js"),
		]);
		assert.equal(carried.length, 0);
	});
});

describe("placeCarriedAttachments", () => {
	const carried = [{ attachment: { type: "file", filename: "/a.js" }, anchor: "prompt", userOrdinal: 1, parentText: "review @a.js" }];

	it("resolves the ordinal to an index in the array being imported", () => {
		const { attachments, skipped } = placeCarriedAttachments(carried, [
			{ role: "user", content: "first" },
			{ role: "assistant", content: [{ type: "text", text: "ok" }] },
			{ role: "user", content: [{ type: "text", text: "review @a.js" }] },
		]);
		assert.equal(skipped.length, 0);
		assert.deepEqual(attachments, [{ afterIndex: 2, attachment: carried[0].attachment }]);
	});

	it("drops it when that prompt changed rather than guessing", () => {
		const { attachments, skipped } = placeCarriedAttachments(carried, [
			{ role: "user", content: "first" },
			{ role: "user", content: "something else entirely" },
		]);
		assert.equal(attachments.length, 0);
		assert.match(skipped[0], /changed/);
	});

	it("drops it when history no longer reaches that prompt", () => {
		const { attachments, skipped } = placeCarriedAttachments(carried, [{ role: "user", content: "first" }]);
		assert.equal(attachments.length, 0);
		assert.match(skipped[0], /no longer in history/);
	});
});

describe("placeCarriedAttachments, tool-result anchor", () => {
	const edited = { type: "edited_text_file", filename: "/b.js" };
	const messages = [
		{ role: "user", content: "go" },
		{ role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "bash", input: {} }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
	];

	it("places it after the message answering that tool call", () => {
		const { attachments, skipped } = placeCarriedAttachments(
			[{ attachment: edited, anchor: "toolResult", toolUseId: "toolu_1" }], messages);
		assert.equal(skipped.length, 0);
		assert.deepEqual(attachments, [{ afterIndex: 2, attachment: edited }]);
	});

	it("matches through the id sanitizing convertPiMessages applies", () => {
		const dotted = [
			messages[0],
			{ role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "bash", input: {} }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "ok" }] },
		];
		const { attachments } = placeCarriedAttachments(
			[{ attachment: edited, anchor: "toolResult", toolUseId: "call.1" }], dotted);
		assert.deepEqual(attachments, [{ afterIndex: 2, attachment: edited }]);
	});

	// The AskClaude case: Claude Code ran a tool of its own inside the shared
	// session, so pi never recorded the call and the rebuild is not reproducing that
	// turn either. Dropping is the honest answer, not a nearby guess.
	it("drops it when pi's history never recorded that tool call", () => {
		const { attachments, skipped } = placeCarriedAttachments(
			[{ attachment: edited, anchor: "toolResult", toolUseId: "toolu_gone" }], messages);
		assert.equal(attachments.length, 0);
		assert.match(skipped[0], /not in this history/);
	});
});

describe("placeCarriedAttachments, ordinal recovery", () => {
	const attachment = { type: "file", filename: "/a.js" };
	// A drained mid-turn steer: pi keeps it as an ordinary user message, Claude Code
	// records it as an attachment on a tool-result record. So the two sides disagree
	// by one about where every later prompt sits.
	const steered = [
		{ role: "user", content: "review @a.js" },
		{ role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "bash", input: {} }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
		{ role: "user", content: "actually, hold on" },
		{ role: "assistant", content: [{ type: "text", text: "ok" }] },
		{ role: "user", content: [{ type: "text", text: "now check @b.js" }] },
	];

	it("recovers a shifted ordinal from the parent text when it is unique", () => {
		const { attachments, skipped } = placeCarriedAttachments(
			[{ attachment, anchor: "prompt", userOrdinal: 1, parentText: "now check @b.js" }], steered);
		assert.equal(skipped.length, 0);
		assert.deepEqual(attachments, [{ afterIndex: 5, attachment }]);
	});

	it("still refuses when the text it would recover by repeats", () => {
		const repeated = [
			{ role: "user", content: "continue" },
			{ role: "assistant", content: [{ type: "text", text: "ok" }] },
			{ role: "user", content: "continue" },
		];
		const { attachments, skipped } = placeCarriedAttachments(
			[{ attachment, anchor: "prompt", userOrdinal: 5, parentText: "continue" }], repeated);
		assert.equal(attachments.length, 0);
		assert.match(skipped[0], /repeats 2x/);
	});
});

describe("attachments chained to other attachments", () => {
	it("inherits the ordinal up a run so the whole run keys to one prompt", () => {
		const carried = collectCarriedAttachments([
			user("u1", "first"),
			user("u2", "edit the files"),
			attach("a1", "u2", "file", "/a.js"),
			attach("a2", "a1", "edited_text_file", "/b.js"),
			attach("a3", "a2", "file", "/c.js"),
		]);
		assert.deepEqual(carried.map((c) => c.attachment.filename), ["/a.js", "/b.js", "/c.js"]);
		assert.deepEqual(carried.map((c) => c.userOrdinal), [1, 1, 1]);
	});

	it("resolves through a kind it does not carry", () => {
		const carried = collectCarriedAttachments([
			user("u1", "go"),
			attach("a1", "u1", "skill_listing"),
			attach("a2", "a1", "file", "/a.js"),
		]);
		assert.deepEqual(carried.map((c) => c.attachment.filename), ["/a.js"]);
		assert.equal(carried[0].userOrdinal, 0);
	});
});
