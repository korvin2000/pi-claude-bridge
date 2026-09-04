#!/usr/bin/env node
/**
 * Claude Code plugins are suppressed for every child the bridge spawns.
 *
 * Same reasoning as CLAUDE_MD_EXCLUDES: pi executes the tools, so a CC plugin
 * contributes no capability to a pi session, only context — and its hooks,
 * commands and agents were written for a harness that is not the one running.
 * superpowers is the sharpest case: its SessionStart hook injects a skill index
 * stamped EXTREMELY_IMPORTANT ordering the model to call a `Skill` tool pi does
 * not expose.
 *
 * The mechanism rests on two properties of the `--settings` flag tier, which is
 * what the SDK's `settings` option is: it outranks user/project/local settings,
 * and it disables only ids named explicitly — `{}` disables nothing. Hence the
 * enumeration, which is what these pin.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { disabledPlugins } from "../src/config.js";

function withClaudeDir(fn) {
	const root = mkdtempSync(join(tmpdir(), "claude-bridge-plugins-"));
	const previous = process.env.CLAUDE_CONFIG_DIR;
	// Pinned rather than relying on HOME: the user-level Claude directory resolves
	// from CLAUDE_CONFIG_DIR when set, and on Windows HOME does not redirect
	// homedir() at all, so without this the test would read the developer's own
	// ~/.claude/settings.json.
	process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
	try {
		return fn(root, process.env.CLAUDE_CONFIG_DIR);
	} finally {
		if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
		else process.env.CLAUDE_CONFIG_DIR = previous;
		rmSync(root, { recursive: true, force: true });
	}
}

const writeSettings = (dir, name, enabledPlugins) => {
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, name), JSON.stringify({ enabledPlugins }));
};

describe("disabledPlugins", () => {
	it("is empty when no Claude Code settings exist", () => withClaudeDir((root) => {
		assert.deepEqual(disabledPlugins(join(root, "project")), {});
	}));

	it("maps every id across user, project and local settings to false", () => withClaudeDir((root, claudeDir) => {
		const cwd = join(root, "project");
		writeSettings(claudeDir, "settings.json", { "superpowers@official": true });
		writeSettings(join(cwd, ".claude"), "settings.json", { "fmt@team": ["1.0.0"] });
		writeSettings(join(cwd, ".claude"), "settings.local.json", { "lint@team": true });

		// Already-false ids are kept: naming one costs nothing, and omitting it
		// would leave a lower tier free to re-enable it.
		assert.deepEqual(disabledPlugins(cwd), {
			"superpowers@official": false,
			"fmt@team": false,
			"lint@team": false,
		});
	}));

	it("reads the user tier from CLAUDE_CONFIG_DIR, the profile the child will load", () => withClaudeDir((root, claudeDir) => {
		writeSettings(claudeDir, "settings.json", { "isolated@profile": true });
		assert.deepEqual(disabledPlugins(join(root, "project")), { "isolated@profile": false });
	}));

	it("ignores an unparseable settings file rather than failing the session", () => withClaudeDir((root, claudeDir) => {
		mkdirSync(claudeDir, { recursive: true });
		writeFileSync(join(claudeDir, "settings.json"), "{ trailing, }");
		assert.deepEqual(disabledPlugins(join(root, "project")), {});
	}));
});
