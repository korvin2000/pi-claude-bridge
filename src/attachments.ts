// Carrying Claude Code's own attachments across a session rebuild.
//
// CC expands an `@file` mention itself — pi passes `@` through untouched — and
// writes the expansion as a `type: "attachment"` record in its session file. pi
// never sees it, so rebuilding a session from pi's history drops the file while
// keeping the prompt text that referred to it: the model silently loses
// something it was reasoning about, with nothing logged.
//
// Extracted from index.ts so tests can import it without activating the extension.

import type { JsonlRecord, ImportAttachment } from "cc-session-io";
import { messageContentToText, sanitizeToolId } from "./convert.js";

// The kinds worth carrying: the ones pi genuinely never sees, so a rebuild is the
// only chance to keep them.
//
// - `file` is an `@file` expansion, hanging off the prompt that mentioned it.
// - `edited_text_file` is a file's fresh contents after something changed it
//   underneath CC. Despite the name it is mostly not an editor's doing: over 290
//   real records on one machine, 268 hang off a `Bash` result, 21 off a prompt and
//   1 off a `Write` — this is CC's staleness tracking re-reading a file it already
//   knows about, not a log of its edits.
//
// Everything else CC rewrites every turn (`skill_listing`, `task_reminder`,
// `agent_listing_delta`, `mcp_instructions_delta`, `total_tokens_reminder`, …) and
// loses nothing.
const CONTENT_BEARING = new Set(["file", "edited_text_file"]);

/** Where a carried attachment hung, in terms a rebuilt transcript can be searched for.
 *
 *  Two anchors because CC parents attachments to two different kinds of record, and
 *  neither key survives a rebuild on its own:
 *
 *  - `prompt` — position among the session's text-bearing user records, plus that
 *    record's text. A rebuild does not reproduce the old record list one-for-one
 *    (`importMessages` splits a message carrying tool results into two records, and
 *    CC appends records of its own), but the sequence of user prompts is the same
 *    conversation either way.
 *  - `toolResult` — the `tool_use_id` of the tool result it hung off. On the
 *    provider path Claude Code's tool_use id *is* pi's toolCallId (the bridge
 *    forwards it verbatim, see mcp-server.ts), so it survives into pi's history and
 *    back out through `convertPiMessages`. When it does not — an AskClaude child
 *    ran a tool of Claude Code's own, which pi never recorded — the id matches
 *    nothing in the rebuilt transcript and the attachment is dropped, which is the
 *    correct answer for context whose parent turn is not being rebuilt either. */
export type CarriedAttachment = {
	attachment: { type: string; [key: string]: unknown };
} & (
	| {
		anchor: "prompt";
		/** Position of the parent among the session's text-bearing user records. */
		userOrdinal: number;
		/** That record's text, to verify the ordinal still points at the same turn. */
		parentText: string;
	}
	| {
		anchor: "toolResult";
		/** `tool_use_id` of the tool result the attachment hung off. */
		toolUseId: string;
	}
);

type Rec = Record<string, unknown>;

/** A user record holding a prompt, as opposed to one holding tool results. */
function userPromptText(record: Rec): string | undefined {
	if (record.type !== "user") return undefined;
	const content = (record.message as Rec | undefined)?.content;
	if (Array.isArray(content) && content.some((b) => (b as Rec)?.type === "tool_result")) return undefined;
	const text = messageContentToText(content as never);
	return text ? text : undefined;
}

/** The `tool_use_id` a user record's tool results answer, when it holds exactly one
 *  distinct id. A record carrying results for several calls at once cannot name one
 *  parent, so it anchors nothing rather than guessing. */
function soleToolUseId(record: Rec): string | undefined {
	if (record.type !== "user") return undefined;
	const content = (record.message as Rec | undefined)?.content;
	if (!Array.isArray(content)) return undefined;
	const ids = new Set<string>();
	for (const block of content) {
		const b = block as Rec;
		if (b?.type === "tool_result" && typeof b.tool_use_id === "string") ids.add(b.tool_use_id);
	}
	return ids.size === 1 ? [...ids][0] : undefined;
}

/**
 * Content-bearing attachments in a session, each tagged with where its parent sits.
 *
 * Attachments also chain to one another, so an anchor is resolved transitively up
 * the parent links until it reaches a message record. 63 of 179 content-bearing
 * attachments in one real scan parent to another attachment rather than to a
 * message, so the inherited anchor is recorded for *every* attachment, not just the
 * carried ones — a content-bearing attachment can chain off a `skill_listing` we
 * otherwise ignore.
 */
export function collectCarriedAttachments(records: readonly JsonlRecord[]): CarriedAttachment[] {
	type Anchor =
		| { kind: "prompt"; userOrdinal: number; parentText: string }
		| { kind: "toolResult"; toolUseId: string };
	const anchorOf = new Map<string, Anchor>();
	let ordinal = 0;
	const carried: CarriedAttachment[] = [];

	for (const raw of records) {
		const record = raw as Rec;
		const prompt = userPromptText(record);
		if (prompt !== undefined) {
			anchorOf.set(record.uuid as string, { kind: "prompt", userOrdinal: ordinal++, parentText: prompt });
			continue;
		}
		const toolUseId = soleToolUseId(record);
		if (toolUseId !== undefined) {
			anchorOf.set(record.uuid as string, { kind: "toolResult", toolUseId });
			continue;
		}
		if (record.type !== "attachment") continue;
		const parent = record.parentUuid as string | null;
		if (parent === null || !anchorOf.has(parent)) continue;
		const inherited = anchorOf.get(parent)!;
		anchorOf.set(record.uuid as string, inherited);

		const attachment = record.attachment as { type: string; [key: string]: unknown } | undefined;
		if (!attachment || !CONTENT_BEARING.has(attachment.type)) continue;
		carried.push(
			inherited.kind === "prompt"
				? { attachment, anchor: "prompt", userOrdinal: inherited.userOrdinal, parentText: inherited.parentText }
				: { attachment, anchor: "toolResult", toolUseId: inherited.toolUseId },
		);
	}
	return carried;
}

/**
 * Resolve each carried attachment to a position in the array about to be
 * imported — the messages *after* conversion and repair, since that is the index
 * space `importMessages` reads. Repair is idempotent, so an already-repaired array
 * passes through its second run unchanged and the indices stay valid.
 *
 * Deliberately conservative: attaching a file to the wrong turn tells the model it
 * saw something at a point it did not, which is worse than the loss this exists to
 * prevent. So every route below has to identify one message unambiguously; any
 * disagreement is reported and dropped rather than approximated.
 */
export function placeCarriedAttachments(
	carried: readonly CarriedAttachment[],
	messages: readonly { role: string; content: unknown }[],
): { attachments: ImportAttachment[]; skipped: string[] } {
	const prompts: { index: number; text: string }[] = [];
	// tool_use_id → index, with a null value for an id seen on more than one message.
	const toolResultIndex = new Map<string, number | null>();
	const idCache = new Map<string, string>();
	messages.forEach((msg, index) => {
		if (msg.role !== "user") return;
		if (Array.isArray(msg.content)) {
			const results = msg.content.filter((b) => (b as Rec)?.type === "tool_result");
			if (results.length) {
				for (const block of results) {
					const id = (block as Rec).tool_use_id;
					if (typeof id !== "string") continue;
					toolResultIndex.set(id, toolResultIndex.has(id) ? null : index);
				}
				return;
			}
		}
		const text = messageContentToText(msg.content as never);
		if (text) prompts.push({ index, text });
	});
	// How often each prompt text occurs, for the recovery route below.
	const promptsByText = new Map<string, number[]>();
	for (const prompt of prompts) {
		const seen = promptsByText.get(prompt.text);
		if (seen) seen.push(prompt.index);
		else promptsByText.set(prompt.text, [prompt.index]);
	}

	const attachments: ImportAttachment[] = [];
	const skipped: string[] = [];
	for (const item of carried) {
		const name = String(item.attachment.filename ?? item.attachment.type);

		if (item.anchor === "toolResult") {
			// pi's history holds the raw id; convertPiMessages sanitized it on the way
			// into this array, so the lookup key has to go through the same rule.
			const id = sanitizeToolId(item.toolUseId, idCache);
			const index = toolResultIndex.get(id);
			if (index === undefined) {
				skipped.push(`${name}: tool call ${item.toolUseId} is not in this history`);
				continue;
			}
			if (index === null) {
				skipped.push(`${name}: tool call ${item.toolUseId} answers more than one message`);
				continue;
			}
			attachments.push({ afterIndex: index, attachment: item.attachment });
			continue;
		}

		const candidate = prompts[item.userOrdinal];
		if (candidate?.text === item.parentText) {
			attachments.push({ afterIndex: candidate.index, attachment: item.attachment });
			continue;
		}
		// The ordinal disagrees. The two sides count prompts differently in at least
		// one real shape: pi keeps a drained mid-turn steer as an ordinary user
		// message, while CC records it as a `queued_command` attachment hanging off a
		// tool-result record — which is not a prompt here — so every prompt after the
		// first steer is off by one, and CC's own `[Request interrupted by user]`
		// record on an abort shifts the count the other way. Rather than model both
		// counting rules, fall back to the text the ordinal was only ever there to
		// confirm: it identifies the turn on its own whenever it is unique, and the
		// ordinal stays the fast path so a healthy session is unaffected.
		const byText = promptsByText.get(item.parentText);
		if (byText?.length === 1) {
			attachments.push({ afterIndex: byText[0], attachment: item.attachment });
			continue;
		}
		// Ambiguity first: it is why recovery refused, and the ordinal's own reason
		// would only say where the fast path happened to land.
		if (byText) skipped.push(`${name}: prompt #${item.userOrdinal} moved and its text repeats ${byText.length}x`);
		else if (!candidate) skipped.push(`${name}: prompt #${item.userOrdinal} is no longer in history`);
		else skipped.push(`${name}: prompt #${item.userOrdinal} changed`);
	}
	return { attachments, skipped };
}
