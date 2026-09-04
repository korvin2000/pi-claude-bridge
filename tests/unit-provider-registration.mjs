#!/usr/bin/env node

/**
 * Provider registration is per session, routed through one stable dispatcher.
 *
 * A ModelRegistry belongs to a session, not to a process. The old guard assumed
 * the opposite: the first module instance stored its streamSimple in a global and
 * every later instance skipped registering, on the theory that a later instance is
 * always a subagent sharing its parent's registry. A host that runs several
 * independent sessions in one process (each building its own registry) then left
 * every session after the first with no claude-bridge models at all — silently,
 * and depending on which session happened to bind first, so it looked intermittent.
 *
 * Registering unconditionally through one shared function object keeps the property
 * the guard existed for: a later registration installs the *same* function rather
 * than a competing closure, so it cannot take tool routing away from an earlier
 * session's in-flight state.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

const { default: activate } = await import("../src/pi.js");

const ACTIVE = Symbol.for("claude-bridge:activeStreamSimple");
const LIVE = Symbol.for("claude-bridge:liveStreamSimples");
const DISPATCH = Symbol.for("claude-bridge:dispatchStreamSimple");

function activateWithMockPi() {
	const handlers = new Map();
	const registrations = [];
	activate({
		on: (event, handler) => handlers.set(event, handler),
		registerProvider: (id, config) => registrations.push({ id, config }),
		registerCommand: () => {},
	});
	return { handlers, registrations };
}

describe("provider registration", () => {
	beforeEach(() => {
		const g = globalThis;
		delete g[ACTIVE];
		delete g[LIVE];
		delete g[DISPATCH];
	});

	it("registers on every activation, not only the first", () => {
		const first = activateWithMockPi();
		const second = activateWithMockPi();
		assert.equal(first.registrations.length, 1, "the first session must be served");
		assert.equal(second.registrations.length, 1, "a second session in the same process must be served too");
	});

	it("hands every registry the same function object", () => {
		const first = activateWithMockPi();
		const second = activateWithMockPi();
		assert.equal(
			first.registrations[0].config.streamSimple,
			second.registrations[0].config.streamSimple,
			"two different closures would let the later session displace the earlier one's routing",
		);
	});

	// The live set holds function objects, and a second `activate()` inside one test
	// process re-runs the same module — so it re-adds the identical entry rather
	// than a second one. In production each module instance is its own load with its
	// own function identity, which is what makes the set a set. What is checkable
	// here is the ownership rule itself.
	it("keeps the first instance as the active implementation", () => {
		activateWithMockPi();
		const active = globalThis[ACTIVE];
		assert.notEqual(active, undefined);
		activateWithMockPi();
		assert.equal(globalThis[ACTIVE], active, "a subagent loading this module must not take over its parent");
		assert.ok(globalThis[LIVE].has(active));
	});

	it("releases ownership when the last live instance shuts down", () => {
		const first = activateWithMockPi();
		assert.ok(globalThis[LIVE].size > 0);
		first.handlers.get("session_shutdown")({});
		assert.equal(globalThis[LIVE].size, 0);
		assert.equal(globalThis[ACTIVE], undefined, "/reload depends on the next activate registering fresh");
	});

	it("self-heals a dispatch that finds the live set empty", () => {
		const { handlers, registrations } = activateWithMockPi();
		// A host that resumes a long-lived session without re-running activate leaves
		// nothing to re-add the instance clearSession removed. Throwing there fails the
		// turn and sends the host to another provider, which then rejects the same
		// model — a stuck thread with an unrelated-looking error.
		handlers.get("session_shutdown")({});
		assert.equal(globalThis[ACTIVE], undefined);

		let served = false;
		const streamSimple = registrations[0].config.streamSimple;
		try {
			// Reaching a real query needs a subprocess; the throw under test happens
			// before any of that, so getting past the lookup is the whole assertion.
			streamSimple({ id: "claude-opus-5" }, { systemPrompt: "", messages: [] }, {});
			served = true;
		} catch (error) {
			assert.doesNotMatch(String(error), /no live provider instance/);
			served = true;
		}
		assert.ok(served);
		assert.notEqual(globalThis[ACTIVE], undefined, "the dispatcher must have re-registered the stable entry point");
	});
});
