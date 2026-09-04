// The Pi / Oh My Pi host boundary.
//
// OMP is a fork of Pi and loads this extension through its legacy-Pi
// compatibility layer: `@earendil-works/pi-*` specifiers are remapped to
// `@oh-my-pi/pi-*` and the package roots are served by compat shims, so nearly
// every import in this repo resolves unchanged on both hosts and the bridge
// itself is shared code. A short list of APIs genuinely diverged, and every one
// of them lives behind this interface:
//
//   - pi-ai's custom-API registry was renamed (`registerApiProvider` ->
//     `registerCustomApi`, and friends), and OMP dispatches every call for a
//     bridge model through it rather than only extension-driven ones.
//   - `compact()` and `generateBranchSummary()` take different arguments, and
//     OMP injects a summarization transport as `completeImpl` (returning one
//     AssistantMessage) rather than Pi's `streamFn`. `generateBranchSummary` is
//     not on OMP's coding-agent root at all.
//   - `session_start` carries a `reason` on Pi; on OMP it carries none and
//     switching sessions fires `session_switch` instead.
//   - `registerTool`'s `renderCall` takes the theme second on Pi and third on
//     OMP.
//   - OMP has no `formatSkillsForPrompt`, and applies a different visibility
//     rule to its own skill list.
//   - `before_agent_start` hands Pi the assembled prompt *and* the parts it was
//     assembled from; OMP hands over only the assembled segments, so the
//     portable parts have to be read back off the host instead.
//
// Two of these — the registry and the renderer arguments — fail at runtime
// rather than at load, and only on the host the code was not written against,
// so each states its answer per host rather than duck-typing one.
//
// Nothing else is host-specific. Keep this interface small: a difference the
// shared core can normalize itself (a string vs. string[] system prompt, say)
// belongs in the core, not here.

import type { AssistantMessage, AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { BranchSummaryResult, CompactionResult, Skill, Theme } from "@earendil-works/pi-coding-agent";
import type { PromptCaptureInput } from "./prompt-capture.js";

/** The bridge's own stream entry points, as both hosts' provider contracts see them. */
export type BridgeStreamFn = (
	model: Model<any>,
	context: Context,
	options?: SimpleStreamOptions,
) => AssistantMessageEventStream;

/** Typed against Pi, which is the dev dependency this repo compiles against.
 *  OMP's own compaction result is the same shape. */
export type HostCompactionResult = CompactionResult;

/** Passed straight through to the host's compaction entry point.
 *
 *  `preparation` is the `session_before_compact` event's own field: the shared
 *  core reads the parts it re-injects file operations into and otherwise leaves
 *  it alone, so it stays opaque across the boundary rather than pinning a type
 *  name that only one host exports. */
export interface CompactRequest {
	preparation: unknown;
	model: Model<any>;
	customInstructions?: string;
	signal?: AbortSignal;
	/** Runs the summary as one isolated Claude Code turn. */
	summaryStream: BridgeStreamFn;
}

/** Passed straight through to the host's branch-summary entry point. */
export interface BranchSummaryRequest {
	entries: unknown[];
	model: Model<any>;
	signal: AbortSignal;
	customInstructions?: string;
	/** Pi only: OMP's branch summarizer always appends custom instructions. */
	replaceInstructions?: boolean;
	summaryStream: BridgeStreamFn;
}

/** The `before_agent_start` / `agent_start` payload, in the shape both hosts share.
 *
 *  Pi's `systemPromptOptions` is the whole point on that host and absent on OMP;
 *  it stays `unknown` here so the core never reads it without going through the
 *  adapter. */
export interface PromptSource {
	systemPrompt: string | undefined;
	systemPromptOptions?: unknown;
	cwd: string;
}

export interface HostBridge {
	/** How to name this host in a log line or a message to the user. Deliberately
	 *  the only identity this interface exposes: every behaviour difference is a
	 *  member below, so nothing can branch on which host it is. */
	readonly label: string;

	// --- pi-ai custom API registry (side requests) ---

	/** Serve extension-driven side requests — an extension running its own
	 *  `agentLoop` against a bridge model — through pi-ai's own API registry.
	 *
	 *  Whether that registry needs an entry at all is a host difference, and the
	 *  wrong answer is destructive rather than merely inert, so it is decided
	 *  here rather than by the core. Returns whether an entry was installed, so
	 *  the caller knows whether it owns one to remove.
	 *
	 *  See the implementations for what each host does and why. */
	installSideRequestApi(api: string, stream: BridgeStreamFn, sourceId: string): boolean;

	/** Remove whatever {@link installSideRequestApi} installed for `sourceId`. */
	removeSideRequestApi(sourceId: string): void;

	// --- session lifecycle ---

	/** The event that reports the user moving to a different session — `/new`,
	 *  `/resume`, a fork — so the shared Claude Code session can be dropped
	 *  rather than carried into the next conversation.
	 *
	 *  Pi reports it as a `reason` on `session_start`. OMP's `session_start`
	 *  carries no reason at all and fires `session_switch` for this instead, so
	 *  reading only `session_start` there would silently resume the previous
	 *  conversation's Claude Code session under a fresh one. */
	readonly sessionSwitchEvent: "session_start" | "session_switch";

	// --- tool rendering ---

	/** Pick the theme out of a tool renderer's arguments after `args`.
	 *
	 *  `registerTool`'s `renderCall` is `(args, theme, context)` on pi and
	 *  `(args, options, theme)` on OMP. Reading the wrong position is not a type
	 *  error at runtime, just a `theme.fg is not a function` the first time the
	 *  tool renders, so the position is stated per host rather than guessed.
	 *  (`renderResult` is `(result, options, theme, ...)` on both.) */
	toolRenderTheme(rest: unknown[]): Theme;

	// --- skills ---

	/** Render a skill list the way this host renders its own, for forwarding to
	 *  Claude Code. Returns "" when nothing is visible to the model. */
	formatSkillsForPrompt(skills: Skill[]): string;

	// --- summarization takeovers ---

	compact(request: CompactRequest): Promise<HostCompactionResult>;
	generateBranchSummary(request: BranchSummaryRequest): Promise<BranchSummaryResult>;

	// --- prompt provenance ---

	/** The portable parts of this turn's system prompt: what Claude Code should
	 *  receive appended to its own preset. */
	promptParts(source: PromptSource): Promise<PromptCaptureInput>;
}

/** Collapse a host's system-prompt representation to the single string the
 *  capture map is keyed by.
 *
 *  Pi's is already a string; OMP assembles its prompt as ordered segments. The
 *  join separator is arbitrary but must be stable, because every site that reads
 *  a system prompt — the `before_agent_start` key, `ctx.getSystemPrompt()`, and
 *  the `Context.systemPrompt` the provider is handed — goes through here, and
 *  they only match each other if they are collapsed the same way. */
export function systemPromptText(prompt: string | readonly string[] | undefined): string | undefined {
	if (prompt === undefined) return undefined;
	if (typeof prompt === "string") return prompt || undefined;
	return prompt.filter(Boolean).join("\n\n") || undefined;
}

/** Resolve a host's summary stream into the single message an OMP-style
 *  `completeImpl` transport returns. Matches pi-ai's own `completeSimple`,
 *  which is `streamSimple(...).result()`: a failed turn resolves with an
 *  assistant message whose `stopReason` is "error" rather than throwing. */
export function streamToMessage(
	stream: BridgeStreamFn,
	model: Model<any>,
	context: Context,
	options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
	return stream(model, context, options).result();
}
