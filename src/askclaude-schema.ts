import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { Config } from "./config.js";

export type AskClaudeMode = "full" | "read" | "none";

export interface AskClaudeDefaults {
	mode: AskClaudeMode;
	isolated: boolean;
	allowFull: boolean;
}

const PACKAGE_DEFAULT_MODE: AskClaudeMode = "read";
const PACKAGE_DEFAULT_ISOLATED = false;

export function resolveAskClaudeDefaults(conf: Config["askClaude"]): AskClaudeDefaults {
	const rawAllowFull: unknown = conf?.allowFullMode;
	const allowFull = rawAllowFull == null ? true : rawAllowFull === true;
	const configuredMode: unknown = conf?.defaultMode;
	const mode = configuredMode == null
		? PACKAGE_DEFAULT_MODE
		: configuredMode === "full" || configuredMode === "read" || configuredMode === "none"
			? configuredMode
			: "none";
	return { mode: !allowFull && mode === "full" ? PACKAGE_DEFAULT_MODE : mode, isolated: conf?.defaultIsolated ?? PACKAGE_DEFAULT_ISOLATED, allowFull };
}

export function resolveAskClaudeMode(mode: unknown, defaults: AskClaudeDefaults): AskClaudeMode {
	const resolved = mode === undefined ? defaults.mode : mode;
	if (resolved !== "full" && resolved !== "read" && resolved !== "none") throw new Error(`Invalid AskClaude mode: ${String(resolved)}`);
	if (resolved === "full" && !defaults.allowFull) throw new Error("AskClaude full mode is disabled.");
	return resolved;
}

function modeDescription(defaults: AskClaudeDefaults): string {
	const mark = (mode: AskClaudeMode) => (mode === defaults.mode ? " (default)" : "");
	const parts = [
		`"read"${mark("read")}: questions about the codebase — review, analysis, explain.`,
		`"none"${mark("none")}: general knowledge only (no file access).`,
	];
	if (defaults.allowFull) {
		parts.push(`"full"${mark("full")}: allows writing and bash execution (careful: runs without feedback to pi).`);
	}
	return parts.join(" ");
}

export function buildAskClaudeParams(defaults: AskClaudeDefaults) {
	const visibility = defaults.isolated
		? "By default Claude sees only this prompt (isolated session)."
		: "By default Claude sees the full conversation history.";
	const trueDefault = defaults.isolated ? " (default)" : "";
	const falseDefault = defaults.isolated ? "" : " (default)";
	const modeValues: readonly AskClaudeMode[] = defaults.allowFull ? ["read", "full", "none"] : ["read", "none"];
	return Type.Object({
		prompt: Type.String({ description: `The question or task for Claude Code. ${visibility} Don't research up front, let Claude explore.` }),
		mode: Type.Optional(StringEnum(modeValues, { description: modeDescription(defaults) })),
		model: Type.Optional(Type.String({ description: 'Claude model (e.g. "opus", "sonnet", "haiku", or full ID). Defaults to "opus".' })),
		thinking: Type.Optional(StringEnum(["off", "minimal", "low", "medium", "high", "xhigh"] as const, { description: "Thinking effort level. Omit to use Claude Code's default." })),
		isolated: Type.Optional(Type.Boolean({ description: `When true${trueDefault}, Claude sees only this prompt (clean session). When false${falseDefault}, Claude sees the full conversation history.` })),
	});
}

export function askClaudeToolDescription(defaults: AskClaudeDefaults, override?: string | null): string {
	if (override != null) return override;
	const suffix = " Prefer to handle straightforward tasks yourself.";
	if (!defaults.allowFull) {
		const middle = defaults.mode === "none"
			? 'Defaults to no file access — pass mode "read" to let Claude Code explore the codebase; it can never make changes.'
			: "Read-only — Claude Code can explore the codebase but not make changes.";
		return `Delegate to Claude Code for a second opinion or analysis (code review, architecture questions, debugging theories). ${middle}${suffix}`;
	}
	const middle = defaults.mode === "full"
		? 'Defaults to full mode — Claude Code writes files and runs bash without feedback to pi; pass mode "read" to keep it to exploration.'
		: defaults.mode === "none"
			? 'Defaults to no file access — pass mode "read" to let Claude Code explore the codebase, or "full" for a task that requires changes.'
			: "Defaults to read-only mode — use full mode when the user wants to delegate a task that requires changes.";
	return `Delegate to Claude Code for a second opinion or analysis (code review, architecture questions, debugging theories), or to autonomously handle a task. ${middle}${suffix}`;
}

export function askClaudeCallTags(
	args: { mode?: AskClaudeMode; model?: string; thinking?: string; isolated?: boolean },
	defaults: AskClaudeDefaults,
): string[] {
	const tags: string[] = [];
	const mode = args.mode ?? defaults.mode;
	if (mode !== PACKAGE_DEFAULT_MODE || (args.mode !== undefined && args.mode !== defaults.mode)) tags.push(`mode=${mode}`);
	if (args.model) tags.push(`model=${args.model}`);
	if (args.thinking) tags.push(`thinking=${args.thinking}`);
	if ((args.isolated ?? defaults.isolated) !== PACKAGE_DEFAULT_ISOLATED) tags.push("isolated");
	return tags;
}

/** Whether an AskClaude child should keep Claude Code's git sections.
 *
 *  `includeGitInstructions` is one flag over two things: the preset's git-workflow
 *  guidance (how to commit, branch, and what never to do), and the volatile
 *  `gitStatus:` block it appends to the cached system prefix. That block claims to
 *  be "the git status at the start of the conversation", but the bridge re-invokes
 *  Claude Code per call, so it is recomputed each time — and because it sits inside
 *  the ephemeral-cached system block, any working-tree transition rewrites the whole
 *  prefix (issue #73). The provider path turns the flag off outright: it runs with
 *  `tools: []`, so the guidance never ships anyway and the block is pure cost.
 *
 *  AskClaude runs Claude Code's native tools, so the guidance is load-bearing —
 *  but only when the child can actually run git, i.e. when Bash is available.
 *  In `read` and `none` mode Bash is disallowed, so the guidance is dead weight
 *  there too and only the stale block and the busted cache remain. Drop it for
 *  those modes and keep it for `full`. */
export function includeGitInstructionsFor(disallowedTools: readonly string[]): boolean {
	return !disallowedTools.includes("Bash");
}
