// Pi implementation of the host boundary. See src/host.ts for why each of these
// exists; this file is the only place that may import a Pi-only export.

import { compact, formatSkillsForPrompt, generateBranchSummary, type BranchSummaryResult, type BuildSystemPromptOptions, type Skill, type Theme } from "@earendil-works/pi-coding-agent";
import { getApiProvider, registerApiProvider, unregisterApiProviders } from "@earendil-works/pi-ai/compat";
import type { BranchSummaryRequest, BridgeStreamFn, CompactRequest, HostBridge, HostCompactionResult, PromptSource } from "./host.js";
import type { PromptCaptureInput } from "./prompt-capture.js";

export const piHost: HostBridge = {
	label: "pi",
	// pi reports /new, /resume and fork as a reason on session_start itself.
	sessionSwitchEvent: "session_start",

	installSideRequestApi(api, stream: BridgeStreamFn, sourceId): boolean {
		// pi's model runtime and pi-ai's registry are separate: `pi.registerProvider`
		// populates the former only, so an extension driving its own `agentLoop` is
		// served by pi-ai's default stream function, resolves the api id here, and
		// throws where nothing catches it unless the bridge registers too.
		//
		// First instance wins: an in-flight side request delivers its tool results
		// back through the module instance that started it. /reload needs no
		// coordination — pi calls resetApiProviders() between shutdown and
		// reactivation.
		if (getApiProvider(api)) return false;
		registerApiProvider({
			api,
			// Cast: both entry points take SimpleStreamOptions, and a side request has no
			// use for the rich `stream` contract — pi's own provider composer likewise
			// routes `stream` to an extension's streamSimple.
			stream: stream as any,
			streamSimple: stream as any,
		}, sourceId);
		return true;
	},

	removeSideRequestApi(sourceId) {
		unregisterApiProviders(sourceId);
	},

	toolRenderTheme(rest): Theme {
		// pi: renderCall(args, theme, context)
		return rest[0] as Theme;
	},

	formatSkillsForPrompt(skills: Skill[]): string {
		return formatSkillsForPrompt(skills);
	},

	compact(request: CompactRequest): Promise<HostCompactionResult> {
		// Positional, and long: apiKey, headers, thinkingLevel and env are all
		// unused here — the summary never reaches an HTTP provider, it goes to a
		// Claude Code subprocess through `streamFn`.
		return compact(
			request.preparation as any,
			request.model,
			undefined,
			undefined,
			request.customInstructions,
			request.signal,
			undefined,
			request.summaryStream,
			undefined,
		);
	},

	generateBranchSummary(request: BranchSummaryRequest): Promise<BranchSummaryResult> {
		return generateBranchSummary(request.entries as any, {
			model: request.model,
			signal: request.signal,
			customInstructions: request.customInstructions,
			replaceInstructions: request.replaceInstructions,
			streamFn: request.summaryStream,
		});
	},

	async promptParts(source: PromptSource): Promise<PromptCaptureInput> {
		// Pi hands the assembly's own inputs to `before_agent_start`, so the
		// portable parts are read straight off the event — no discovery, and no
		// chance of reporting something the turn did not actually use.
		const options = source.systemPromptOptions as BuildSystemPromptOptions | undefined;
		const hasRead = !options?.selectedTools || options.selectedTools.includes("read");
		return {
			custom: options?.customPrompt,
			append: options?.appendSystemPrompt,
			contextFiles: options?.contextFiles ?? [],
			skills: hasRead ? options?.skills ?? [] : [],
		};
	},
};
