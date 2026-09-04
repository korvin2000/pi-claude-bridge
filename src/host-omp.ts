// Oh My Pi implementation of the host boundary. See src/host.ts for why each of
// these exists, and src/oh-my-pi.d.ts for the OMP surface it relies on.
//
// The `@oh-my-pi/*` specifiers below are deliberate, not a scope rename of the
// shared core: OMP resolves both scopes to the same modules, so writing the
// canonical one here only says that this file is the OMP half. The shared core
// keeps its `@earendil-works/*` imports, which is what lets OMP's compat shims
// serve it the legacy helpers it was written against.

import { compact, generateBranchSummary } from "@oh-my-pi/pi-agent-core/compaction";
import { discoverContextFiles, getActiveSkills, type OmpSkill } from "@oh-my-pi/pi-coding-agent";
import type { BranchSummaryResult, Skill, Theme } from "@earendil-works/pi-coding-agent";
import { streamToMessage, type BranchSummaryRequest, type CompactRequest, type HostBridge, type HostCompactionResult, type PromptSource } from "./host.js";
import type { PromptCaptureInput } from "./prompt-capture.js";
import { formatSkillList } from "./skills.js";

/** OMP resolves the credential itself for built-in providers and ignores it for
 *  a custom API, and the bridge's summaries never reach an HTTP provider at all:
 *  they go to a Claude Code subprocess through `completeImpl`. Both summarizers
 *  still take the parameter positionally, so it is passed explicitly rather than
 *  left to read as an oversight. */
const UNUSED_API_KEY = undefined;

export const ompHost: HostBridge = {
	label: "Oh My Pi",
	// OMP's session_start has no reason; switching fires its own event.
	sessionSwitchEvent: "session_switch",

	installSideRequestApi(): boolean {
		// Nothing to install, and installing anything here would be actively
		// harmful. Unlike pi, OMP has no second provider path: `streamSimple` and
		// `stream` both consult the custom-API registry first, so EVERY call for a
		// bridge model — the conversation turn included — arrives through it. OMP
		// puts the provider's own stream function there itself when it applies the
		// queued `pi.registerProvider` during session creation.
		//
		// A side-only entry registered on top of that would take the main lane with
		// it: every conversation turn would be served as a self-contained Claude
		// Code session with pi's prompt sent verbatim and no shared session. The
		// side lane is still reached, through the provider entry's own
		// foreign-one-shot check, which is what serves OMP's summarization oneshots
		// too.
		return false;
	},

	removeSideRequestApi() {
		// Nothing was installed; the entry belongs to OMP.
	},

	toolRenderTheme(rest): Theme {
		// OMP: renderCall(args, options, theme)
		return rest[1] as Theme;
	},

	formatSkillsForPrompt(skills: Skill[]): string {
		// OMP has no `formatSkillsForPrompt`, and its own listing renders skills as
		// `skill://<name>` URIs the Claude Code subprocess cannot open. `hide` is
		// OMP's spelling of Pi's `disableModelInvocation`.
		const visible = (skills as unknown as OmpSkill[]).filter((skill) => !skill.hide);
		return formatSkillList(visible);
	},

	compact(request: CompactRequest): Promise<HostCompactionResult> {
		return compact(
			request.preparation,
			request.model,
			UNUSED_API_KEY,
			request.customInstructions,
			request.signal,
			{
				completeImpl: (model, ctx, options) => streamToMessage(request.summaryStream, model, ctx, options),
				// The Claude Code subprocess already retried whatever it could, and
				// pi's compaction caller retries the attempt as a whole; an inner
				// budget on top would multiply the two.
				oneshotRetry: false,
			},
		);
	},

	generateBranchSummary(request: BranchSummaryRequest): Promise<BranchSummaryResult> {
		// `replaceInstructions` has no OMP equivalent — its summarizer always uses
		// custom instructions in place of its default prompt, which is what the
		// replacing case wants and a superset of the appending one.
		return generateBranchSummary(request.entries, {
			model: request.model,
			apiKey: UNUSED_API_KEY,
			signal: request.signal,
			customInstructions: request.customInstructions,
			completeImpl: (model, ctx, options) => streamToMessage(request.summaryStream, model, ctx, options),
		});
	},

	async promptParts(source: PromptSource): Promise<PromptCaptureInput> {
		// OMP's `before_agent_start` carries the assembled prompt and nothing
		// about how it was assembled, so the portable parts are read back off the
		// host. Recording the assembled prompt as `custom` instead would ship
		// OMP's entire harness — its tool inventory, its delegation policy, its
		// rules — into Claude Code on top of Claude Code's own preset, which is
		// the exact duplication the capture mechanism exists to prevent.
		//
		// Not recovered on this host: a `--system-prompt` / `--append-system-prompt`
		// override. OMP resolves both into the assembled text without exposing
		// their provenance, and no supported API hands them back.
		const contextFiles = await discoverContextFiles(source.cwd).catch(() => []);
		return {
			custom: undefined,
			append: undefined,
			contextFiles: contextFiles.map((file) => ({ path: file.path, content: file.content })),
			// Whether the model can open a skill file is decided downstream, by
			// which reader the bridge gives the Claude Code child; OMP has no
			// per-turn tool list here to gate on.
			skills: getActiveSkills() as unknown as Skill[],
		};
	},
};
