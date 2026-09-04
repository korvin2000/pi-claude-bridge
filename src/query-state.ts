// Query state: QueryContext class.
//
// All per-query and per-turn mutable state lives here. Reentrant queries
// (subagents) each get their own QueryContext instance, managed by index.ts.
// Adding a new field = one property on the class.
//
// Extracted from index.ts so tests can import without activating the extension.

import type { AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import type { McpResult } from "./extract-tool-results.js";
import type { PromptStream } from "./prompt-stream.js";
import type { StreamMonitor } from "./stream-resilience.js";

export interface PendingToolCall {
	toolName: string;
	resolve: (result: McpResult) => void;
}

export class QueryContext {
	// Query-scoped (fully isolated per query)
	activeQuery: unknown | null = null;
	currentPiStream: AssistantMessageEventStream | null = null;
	latestCursor = 0;
	streamMonitor: StreamMonitor | null = null;
	pendingToolCalls = new Map<string, PendingToolCall>();
	pendingResults = new Map<string, McpResult>();
	/** tool_use ids emitted this turn. Sole purpose is routing a delivered result
	 *  to the owning query when several queries are in flight — pairing a result
	 *  to its call is done by id from Claude's tools/call _meta, not from here. */
	turnToolCallIds: string[] = [];
	/** Session id from the active attempt, retained through an aborted generator
	 *  shutdown so provider finalization can still record it. */
	capturedSessionId: string | undefined;
	/** Streaming-input handle for the active query — how steers reach CC mid-turn. */
	promptStream: PromptStream | null = null;
	/** Last rate-limit rejection seen on this query. Claude Code sends it just before the
	 *  failure it caused, which is the only thing tying the two together. */
	rateLimitRejection: { rateLimitType?: string; resetsAt?: number } | null = null;
	/** Highest 5% utilization bucket we notified for, so repeat rate_limit_event spam is suppressed. */
	lastRateLimitWarnStep: number | null = null;
	lastRateLimitWarnThreshold: number | undefined;

	// Per-turn (reset together)
	turnOutput: AssistantMessage | null = null;
	turnStarted = false;
	turnSawStreamEvent = false;
	turnSawToolCall = false;

	get turnBlocks(): Array<any> {
		if (!this.turnOutput) throw new Error("turnBlocks accessed before resetTurnState");
		return this.turnOutput.content;
	}

	/** Answer every parked MCP handler with `reason` and forget the turn's queued
	 *  results. Called when the query it belongs to is going away (abort, error,
	 *  normal end). Handlers must be *resolved*, not rejected: an error reply is
	 *  still a reply, and a handler left awaiting a subprocess that is gone keeps
	 *  CC's tools/call open forever, which wedges pi's turn behind it. */
	releasePendingToolCalls(reason: string): void {
		for (const pending of this.pendingToolCalls.values()) pending.resolve({ content: [{ type: "text", text: reason }] });
		this.pendingToolCalls.clear();
		this.pendingResults.clear();
	}

	resetTurnState(model: Model<any>): void {
		this.turnOutput = {
			role: "assistant", content: [],
			api: model.api, provider: model.provider, model: model.id,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "stop", timestamp: Date.now(),
		};
		this.turnStarted = false;
		this.turnSawStreamEvent = false;
		this.turnSawToolCall = false;
		// turnToolCallIds is NOT reset — it persists across tool-result delivery
		// callbacks within the same assistant message so results can be routed to
		// this query while its handlers are still pending.
	}
}

let _ctx = new QueryContext();

export function ctx(): QueryContext { return _ctx; }

// Test-only: replace the module-level context so test files start clean.
// Not called from production.
export function resetCtx(): void {
	_ctx = new QueryContext();
}

/** Abort teardown for one query: settle everything that would otherwise be left
 *  awaiting a subprocess we are about to kill. The pump abandons iteration on
 *  abort, so an in-flight prompt-stream push would hang forever and take
 *  tool-result delivery with it. `reason` is the text handed to parked MCP
 *  handlers and the failed prompt stream; it defaults to the abort wording so the
 *  onAbort call site reads unchanged. */
export function drainForAbort(c: QueryContext, promptStream: PromptStream, reason = "Operation aborted"): void {
	promptStream.fail(new Error(reason));
	c.releasePendingToolCalls(reason);
}

/** The minimal live-query handle the reaper drives (the SDK `query()` result). */
interface ReapableQuery {
	interrupt(): Promise<unknown>;
	close(): void;
}

/** Kill every Claude Code child still parked in `contexts` and empty the set.
 *
 *  A query that SETTLED rather than aborted leaves its child parked at a tool
 *  boundary, and the SDK spawns claude with no parent-death watchdog: on host exit
 *  that child reparents and keeps billing the subscription. Nothing else tore these
 *  down - clearSession nulls the shared session and the stream-fn global but never
 *  touches this set.
 *
 *  Pure and importable (takes the set explicitly) so it is unit-testable without
 *  activating the extension. Snapshots first: each query's own `.finally()` deletes
 *  from `contexts` as it settles, so iterating the live set would skip entries.
 *  Draining is guarded separately from the kill: settling parked handlers is
 *  best-effort, but the kill and the set removal must happen even when a drain
 *  throws - a context skipped there is exactly the orphaned child this exists to
 *  prevent. */
export function reapLiveQueries(contexts: Set<QueryContext>, reason: string): void {
	for (const queryCtx of [...contexts]) {
		try {
			if (queryCtx.promptStream) drainForAbort(queryCtx, queryCtx.promptStream, reason);
		} catch {
			// Best-effort settling only; the kill below still runs.
		}
		const q = queryCtx.activeQuery as ReapableQuery | null;
		if (q) {
			// interrupt() asks the CLI to stop gracefully; close() kills it. Both are
			// needed (interrupt alone lets the current API call finish), and interrupt
			// must NOT be awaited before close - a sync try/catch would not catch its
			// rejection, so swallow it on the promise instead.
			try { void q.interrupt().catch(() => {}); } catch {}
			try { q.close(); } catch {}
		}
		queryCtx.activeQuery = null;
		contexts.delete(queryCtx);
	}
}

/** Owner-gated wrapper over `reapLiveQueries`. The gate is a separate pure seam so
 *  the non-owner no-op is unit-testable; the pure reaper itself takes no ownership
 *  input. Only the instance that registered the provider reaps, mirroring the
 *  existing ACTIVE_STREAM_SIMPLE_KEY guard, so a non-owner same-cwd session's
 *  shutdown does not tear down the owner's queries. */
export function reapLiveQueriesIfOwner(isOwner: boolean, contexts: Set<QueryContext>, reason: string): void {
	if (isOwner) reapLiveQueries(contexts, reason);
}
