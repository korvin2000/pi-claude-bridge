// Detect a tool call Claude serialized as literal text instead of a structured
// `tool_use` block (GitHub issue #36).
//
// The failure shape: the turn ends with `stop_reason=end_turn`, pi sees an
// ordinary text answer, and the work simply stops — the model believed it had
// called a tool. Reported mostly on long 1M-context sessions.
//
// This module only *reports* the condition. It deliberately does not synthesize
// a real tool call from the parsed text, which is what the issue's author does
// locally: doing so would execute a command that never arrived as a structured
// request, so any `<invoke>` block the model merely *quoted* — documentation, a
// bug report about this very failure, a code sample — becomes a live command.
// Turning a silent stall into a named one costs nothing and is the part that is
// safe to do unconditionally; recovering by execution is a policy call for the
// maintainer, and belongs behind opt-in config if it is wanted at all.

/** A well-formed `<invoke name="...">…</invoke>` written as text. Both the bare
 *  and `antml:`-namespaced spellings appear in the wild. The closing tag is
 *  required: a bare mention with no close is prose, not a serialized call. */
const INVOKE_PATTERN = /<(?:antml:)?invoke\s+name="([^"\n]{1,128})"\s*>[\s\S]{0,20000}?<\/(?:antml:)?invoke\s*>/g;

/** Tool names from every leaked invoke block in `text`, in order, deduplicated. */
export function findLeakedToolCalls(text: string): string[] {
	if (!text.includes("invoke")) return [];
	const names: string[] = [];
	for (const match of text.matchAll(INVOKE_PATTERN)) {
		const name = match[1].trim();
		if (name && !names.includes(name)) names.push(name);
	}
	return names;
}

/** The leaked names when a turn ended on text that only *looks* like it called a
 *  tool: no structured `tool_use` reached pi, so nothing will run and pi is about
 *  to treat the turn as a finished answer. Empty when the turn is unremarkable —
 *  a turn that did make a real call is not this bug, even if it also quoted an
 *  invoke block, and an errored or aborted turn has a cause of its own to report. */
export function leakedToolCallsEndingTurn(
	content: readonly unknown[],
	sawStructuredToolCall: boolean,
	stopReason: string | undefined,
): string[] {
	if (sawStructuredToolCall) return [];
	if (stopReason !== undefined && stopReason !== "stop" && stopReason !== "end_turn") return [];
	const names: string[] = [];
	for (const block of content) {
		const text = (block as { type?: string; text?: unknown }).type === "text"
			? (block as { text?: unknown }).text
			: undefined;
		if (typeof text !== "string") continue;
		for (const name of findLeakedToolCalls(text)) if (!names.includes(name)) names.push(name);
	}
	return names;
}
