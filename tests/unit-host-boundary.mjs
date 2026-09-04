#!/usr/bin/env node

/**
 * The core asks the host adapter what to do; it does not decide for itself.
 *
 * The side-request registry is the case where getting that wrong is destructive
 * rather than inert. On pi, `pi.registerProvider` populates only pi's model
 * runtime, so the bridge must also register the api id in pi-ai's registry or an
 * extension driving its own `agentLoop` throws where nothing catches it. On Oh
 * My Pi that same registry is the single dispatch point for *every* call to a
 * bridge model — the conversation turn included — and OMP fills it in itself; an
 * extra side-only entry there would serve every turn as a self-contained Claude
 * Code session with pi's prompt sent verbatim.
 *
 * `src/host-omp.ts` cannot be imported here (it imports `@oh-my-pi/*`, which
 * only the OMP binary provides), so these drive the core through a stub adapter
 * and pin that it follows whatever the adapter reports.
 *
 * This file activates the extension against a stub host, which sets the module's
 * host for the whole process. Keep it in its own file.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createExtension } from "../src/index.js";

function stubHost(installs, sessionSwitchEvent = "session_start") {
	const calls = { installed: [], removed: [] };
	const host = {
		label: installs ? "pi" : "Oh My Pi",
		sessionSwitchEvent,
		installSideRequestApi(api, stream, sourceId) {
			calls.installed.push({ api, stream, sourceId });
			return installs;
		},
		removeSideRequestApi(sourceId) {
			calls.removed.push(sourceId);
		},
		toolRenderTheme: (rest) => rest[0],
		formatSkillsForPrompt: () => "",
		compact: async () => ({ summary: "" }),
		generateBranchSummary: async () => ({ summary: "" }),
		promptParts: async () => ({ contextFiles: [], skills: [] }),
	};
	return { host, calls };
}

function activateWith(host) {
	const handlers = new Map();
	createExtension(host)({
		on: (event, handler) => handlers.set(event, handler),
		registerProvider: () => {},
		registerCommand: () => {},
	});
	return handlers;
}

describe("side-request API registration", () => {
	it("offers the api id to the adapter, with the side-request stream", () => {
		const { host, calls } = stubHost(true);
		activateWith(host);
		assert.equal(calls.installed.length, 1);
		assert.equal(calls.installed[0].api, "claude-bridge");
		assert.equal(typeof calls.installed[0].stream, "function");
		assert.ok(calls.installed[0].sourceId, "an owning source id is required to tear the entry down again");
	});

	it("tears down only an entry the adapter actually installed", () => {
		const installed = stubHost(true);
		activateWith(installed.host).get("session_shutdown")({});
		assert.deepEqual(installed.calls.removed, [installed.calls.installed[0].sourceId]);

		// A host that declined owns the registry entry itself. Removing "ours"
		// there would strip the host's own provider dispatch.
		const declined = stubHost(false);
		activateWith(declined.host).get("session_shutdown")({});
		assert.deepEqual(declined.calls.removed, []);
	});
});

describe("tool renderer arguments", () => {
	// `registerTool`'s renderCall is (args, theme, context) on pi and
	// (args, options, theme) on OMP. Reading the wrong slot is not a type error
	// at runtime — it surfaces as `theme.fg is not a function` the first time the
	// tool renders, which is why the position comes from the adapter.
	it("takes the theme from the position the adapter names", async () => {
		const { piHost } = await import("../src/host-pi.js");
		const theme = { fg: () => "" };
		assert.equal(piHost.toolRenderTheme([theme, { expanded: false }]), theme);
		// OMP's adapter cannot be imported here (it imports @oh-my-pi/*), so its
		// position is pinned by tests/unit-omp-compat.mjs reading the source.
	});
});

describe("session switching", () => {
	// pi puts a reason on session_start; OMP's session_start has none and fires
	// session_switch instead. Reading only session_start there would carry the
	// previous conversation's Claude Code session into the next one.
	it("registers the switch event the adapter names, and only when it differs", () => {
		const pi = activateWith(stubHost(true, "session_start").host);
		assert.ok(pi.has("session_start"));
		assert.ok(!pi.has("session_switch"), "pi reports switching on session_start itself");

		const omp = activateWith(stubHost(false, "session_switch").host);
		assert.ok(omp.has("session_start"), "still needed for ui, mode and cwd");
		assert.ok(omp.has("session_switch"));
	});

	it("captures ui, mode and cwd from session_start on both", () => {
		const handlers = activateWith(stubHost(false, "session_switch").host);
		// A reasonless session_start must not throw on the way through.
		handlers.get("session_start")({ type: "session_start" }, { ui: {}, mode: "tui", cwd: "/tmp/x" });
		handlers.get("session_switch")({ type: "session_switch", reason: "new" }, { cwd: "/tmp/x" });
	});
});
