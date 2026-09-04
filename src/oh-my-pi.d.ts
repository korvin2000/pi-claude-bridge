// Ambient declarations for the Oh My Pi packages `src/host-omp.ts` imports.
//
// OMP is not a dependency of this repo: it ships as a compiled binary that
// serves `@oh-my-pi/pi-*` to the extensions it loads, and installing a second
// copy of the host's own packages is the anti-pattern its plugin docs warn
// about. So the OMP surface the bridge actually uses is declared here instead,
// which keeps `tsc --noEmit` honest about it and makes the dependency explicit:
// this file IS the contract, and anything the adapter needs has to be added
// here first.
//
// Verified against oh-my-pi 18.1.10 (`packages/{ai,agent,coding-agent}/src`).

declare module "@oh-my-pi/pi-ai" {
	import type { AssistantMessageEventStream, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";

	type CustomStreamSimpleFn = (
		model: Model<any>,
		context: Context,
		options?: SimpleStreamOptions,
	) => AssistantMessageEventStream;

	export interface RegisteredCustomApi {
		stream: CustomStreamSimpleFn;
		streamSimple: CustomStreamSimpleFn;
		sourceId?: string;
	}

	/** Throws when `api` collides with one of OMP's built-in API names. */
	export function registerCustomApi(
		api: string,
		streamSimple: CustomStreamSimpleFn,
		sourceId?: string,
		stream?: CustomStreamSimpleFn,
	): void;
	export function getCustomApi(api: string): RegisteredCustomApi | undefined;
	export function unregisterCustomApis(sourceId: string): void;
}

declare module "@oh-my-pi/pi-agent-core/compaction" {
	import type { AssistantMessage, Context, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
	import type { BranchSummaryResult, CompactionResult } from "@earendil-works/pi-coding-agent";

	/** OMP's replacement for Pi's `streamFn`: one call, one finished message. */
	type CompleteImpl = (
		model: Model<any>,
		ctx: Context,
		options: SimpleStreamOptions,
	) => Promise<AssistantMessage>;

	export interface SummaryOptions {
		completeImpl?: CompleteImpl;
		/** Off here: the caller owns retries, and a Claude Code subprocess that
		 *  fails has already exhausted its own. */
		oneshotRetry?: false | Record<string, unknown>;
		[key: string]: unknown;
	}

	export function compact(
		preparation: any,
		model: Model<any>,
		apiKey: string | undefined,
		customInstructions?: string,
		signal?: AbortSignal,
		options?: SummaryOptions,
	): Promise<CompactionResult>;

	export interface GenerateBranchSummaryOptions {
		model: Model<any>;
		apiKey: string | undefined;
		signal: AbortSignal;
		customInstructions?: string;
		reserveTokens?: number;
		completeImpl?: CompleteImpl;
	}

	export function generateBranchSummary(
		entries: any[],
		options: GenerateBranchSummaryOptions,
	): Promise<BranchSummaryResult>;
}

declare module "@oh-my-pi/pi-coding-agent" {
	/** OMP's skill record. Same three fields the bridge forwards to Claude Code
	 *  as Pi's, but its model-visibility flag is `hide`, not
	 *  `disableModelInvocation`. */
	export interface OmpSkill {
		name: string;
		description: string;
		filePath: string;
		baseDir: string;
		source: string;
		hide?: boolean;
	}

	/** The skills loaded for the running session. */
	export function getActiveSkills(): readonly OmpSkill[];

	/** AGENTS.md and friends, discovered walking up from `cwd`, sorted by depth
	 *  with the closest file last. */
	export function discoverContextFiles(
		cwd?: string,
		agentDir?: string,
		disabledExtensions?: string[],
	): Promise<Array<{ path: string; content: string; depth?: number }>>;
}
