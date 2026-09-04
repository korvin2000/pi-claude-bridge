// User-facing extension config. Loaded once at extension registration from
// the global agent dir (getAgentDir(), e.g. ~/.pi/agent/claude-bridge.json)
// and the project Pi config directory, project overriding global. Missing or
// unparseable files are ignored (error to console.error, empty object
// returned) so the extension always starts.

import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export interface Config {
	/** Date (YYYY-MM-DD) the one-time startup notice was shown. Written by the extension, not the user. */
	startupNoticeShown?: string;
	askClaude?: {
		enabled?: boolean;
		name?: string;
		label?: string;
		description?: string;
		defaultMode?: "full" | "read" | "none";
		defaultIsolated?: boolean;
		allowFullMode?: boolean;
		appendSkills?: boolean;
	};
	/** Low-level Claude Agent SDK plumbing. Most users won't need these. */
	provider?: {
		strictMcpConfig?: boolean;
		autoMemoryEnabled?: boolean;
		pathToClaudeCodeExecutable?: string;
		// Subscription plan tier. Setting to "max" enables Opus 4.6 at 1M context
		plan?: "pro" | "max";
		// Set to true to opt into metered 1M context usage ("extra usage" in
		// Anthropic billing). Enables Sonnet 4.6 [1m] on every plan and Opus 4.6
		// [1m] on Pro.
		longContextExtraUsage?: boolean;
	};
	compaction?: {
		// When true (default), the extension answers session_before_compact and
		// runs pi's compact() through an isolated Claude Code subprocess (no
		// tools, no skills, single turn). Set to false to stand down so native
		// pi compaction or another extension owns the summary instead.
		takeover?: boolean;
	};
	branchSummary?: {
		// When true (default), the extension answers session_before_tree the same
		// way. Set to false only when another extension owns branch summaries:
		// unlike compaction, native fall-through cannot work on a bridge model,
		// because pi's branch-summary prompt reaches the provider unrecorded and
		// resolveOrDerive throws on it.
		takeover?: boolean;
	};
}

export function tryParseJson(path: string): Partial<Config> {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch (e) {
		console.error(`claude-bridge: failed to parse ${path}: ${e}`);
		return {};
	}
}

export function claudeCodeSettings(provider: Config["provider"] = {}): { autoMemoryEnabled: boolean } {
	return { autoMemoryEnabled: provider.autoMemoryEnabled ?? false };
}

function enabledPluginIds(path: string): string[] {
	if (!existsSync(path)) return [];
	try {
		const plugins = JSON.parse(readFileSync(path, "utf-8"))?.enabledPlugins;
		return plugins && typeof plugins === "object" ? Object.keys(plugins) : [];
	} catch (e) {
		console.error(`claude-bridge: failed to parse ${path}: ${e}`);
		return [];
	}
}

/** Every plugin id the user's Claude Code settings could enable, mapped to false.
 *
 *  Same reasoning as CLAUDE_MD_EXCLUDES in index.ts: pi executes tools, so a CC
 *  plugin contributes no capability here, only context. Its hooks, commands and
 *  agents are written for a harness that is not the one running. The superpowers
 *  SessionStart hook is the sharpest case — it injects a skill index stamped
 *  EXTREMELY_IMPORTANT that orders the model to call a `Skill` tool pi does not
 *  expose, and it does so having correctly detected "Claude Code", because the
 *  SDK sets CLAUDE_PLUGIN_ROOT no matter which harness owns the session.
 *
 *  Two reasons this also protects the prompt cache: a SessionStart hook's output
 *  is injected per session and need not be byte-stable across the rebuilds this
 *  bridge performs, and plugin commands/agents enlarge the very prefix every turn
 *  re-sends.
 *
 *  Delivered through the `settings` option, i.e. the `--settings` flag tier,
 *  which outranks user/project/local (precedence: user < project < local < flag
 *  < policy). So this suppresses without touching the user's own config, and
 *  their plugins keep working under real Claude Code. Two consequences of that
 *  tier: only ids named explicitly are disabled — `{}` would disable nothing,
 *  which is why the settings files are read rather than just overridden — and
 *  policy-tier plugins survive, by design.
 *
 *  Reads CLAUDE_CONFIG_DIR when set, since that is the profile the child will
 *  actually load its user settings from; every session op in index.ts resolves
 *  the user-level Claude directory the same way. */
export function disabledPlugins(cwd: string): Record<string, false> {
	const userClaudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
	const sources = [
		join(userClaudeDir, "settings.json"),
		join(cwd, ".claude", "settings.json"),
		join(cwd, ".claude", "settings.local.json"),
	];
	const disabled: Record<string, false> = {};
	for (const path of sources) for (const id of enabledPluginIds(path)) disabled[id] = false;
	return disabled;
}

export function globalConfigPath(): string {
	return join(getAgentDir(), "claude-bridge.json");
}

/** Record today's date in the global config so the startup notice shows once, preserving every
 *  other field. Returns the config path for display either way.
 *
 *  Parses directly rather than through tryParseJson, which reports an unparseable file as `{}`:
 *  spreading that would replace a user's whole config with just this marker the first time they
 *  leave a trailing comma in it. Losing the notice is the cheaper failure, so the write is
 *  skipped and the notice simply shows again next session. */
export function markStartupNoticeShown(): string {
	const path = globalConfigPath();
	let existing: Partial<Config> = {};
	if (existsSync(path)) {
		try {
			existing = JSON.parse(readFileSync(path, "utf-8"));
		} catch (e) {
			console.error(`claude-bridge: leaving ${path} alone, it does not parse: ${e}`);
			return path;
		}
	}
	// en-CA renders YYYY-MM-DD in local time; toISOString() would report UTC.
	const next = { ...existing, startupNoticeShown: new Date().toLocaleDateString("en-CA") };
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
	return path;
}

export function loadConfig(cwd: string): Config {
	const global = tryParseJson(globalConfigPath());
	const project = tryParseJson(join(cwd, CONFIG_DIR_NAME, "claude-bridge.json"));
	return {
		startupNoticeShown: project.startupNoticeShown ?? global.startupNoticeShown,
		askClaude: { ...global.askClaude, ...project.askClaude },
		provider: { ...global.provider, ...project.provider },
		compaction: { ...global.compaction, ...project.compaction },
		branchSummary: { ...global.branchSummary, ...project.branchSummary },
	};
}
