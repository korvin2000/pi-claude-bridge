// Descriptions that survive Claude Code's tool-description cap.
//
// Claude Code truncates every MCP tool description at CC_TOOL_DESCRIPTION_CAP
// characters when it renders the tool into the model prompt. It is a lexical
// constant in the binary with no override, and it does so silently — an
// oversized pi tool arrives at the model amputated mid-sentence, which reads to
// the model as a tool whose documentation simply stops. Measured at 2048 across
// CC 2.1.220–2.1.226 by pi-doppelclaude, which recovers it by scanning the
// binary for the truncation log literal; this fork hard-codes it instead.
//
// The head of a description carries the core contract, so what truncation
// destroys is the tail — and OMP puts its sharpest rules there. `read` ends on a
// <critical> block ordering the model to re-issue only elided ranges and never
// guess `..` content; `eval` ends on one saying prior top-level names survive
// into the next cell and must never be re-imported. Both are past the cut today.
// That is the specific harm this module undoes: not "the model sees fewer
// words", but "the model never sees the rules the author put last".
//
// So instead of forwarding text that will be cut, the bridge forwards a
// replacement written to fit — condensed by hand, offline, per tool. Three
// properties make that safe rather than merely shorter:
//
//   - Deterministic. No model runs here and nothing is generated at startup. A
//     description that varied between sessions would break the prompt cache on
//     every turn, which costs more than truncation ever did.
//   - Verified. Each profile names markers it was authored against. If the live
//     description no longer carries them — OMP changed the text, or this session
//     renders a variant nobody wrote a profile for — the bridge ships the
//     ORIGINAL and says so. A stale condensation is worse than a truncation:
//     truncation is visibly incomplete, wrong documentation is not.
//   - Splicing, not freezing. OMP assembles descriptions at runtime from
//     Handlebars templates plus session state, so the parts that matter most are
//     the ones a frozen string cannot carry: `task` names the project's own
//     agents, `eval` lists the kernel API for the languages actually enabled.
//     Those spans are lifted out of the LIVE text and dropped into the
//     replacement verbatim, trimmed at item boundaries when they do not fit.
//
// Nothing here reaches pi. Descriptions are rewritten on the way into the MCP
// server and nowhere else, so pi still validates and executes every tool against
// its own schema and its own docs; only the model's copy changes.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";

/** See the header: a constant in the Claude Code binary, not a setting. */
export const CC_TOOL_DESCRIPTION_CAP = 2048;

/** Profiles shipped with the package. `files: ["src", …]` carries them to npm. */
const BUILTIN_PROFILE_ROOT = fileURLToPath(new URL("./tool-descriptions/", import.meta.url));

/** The only thing this module needs of a tool: a name and prose. */
export interface DescribedTool {
	name: string;
	description?: string;
}

/** Where a slot's text is lifted from in the live description.
 *
 *  All three degrade to the empty string when the span is absent, so a template
 *  never has to ask whether this session enabled the feature the span documents. */
export type SlotSource =
	/** The `<examples>…</examples>` block pi appends from a tool's structured
	 *  examples (OMP's `normalizeTools`), trimmed one `<example>` at a time. */
	| { from: "examples" }
	/** An XML-ish block OMP writes into its prompt markdown: `<prelude>`, `<critical>`. */
	| { from: "block"; tag: string }
	/** A markdown section, from its heading to the next heading of the same or
	 *  higher level — `# Available Agents` and the roster under it. */
	| { from: "section"; heading: string }
	/** The first line containing `contains`. This is how a template carries a
	 *  sentence OMP renders conditionally — `read`'s hashline bullet appears only
	 *  in hashline mode — without the profile having to guess which mode is on.
	 *  Absent line, empty slot, and the surrounding prose stays true either way. */
	| { from: "line"; contains: string };

export interface Variant {
	/** Names the shape, for the debug log and the authoring loop: `hashline`, `sync-batch`. */
	id: string;
	/** Every one of these must appear in the live description for this variant to
	 *  claim it. Pick spans that would not survive a rewrite of what they document. */
	requires: string[];
	/** What the author measured when they wrote the template. Advisory: a large
	 *  deviation is logged as drift worth re-reading, never as a failure, because
	 *  the live length moves with session state all on its own. */
	verifiedLength?: number;
	/** Template filename, relative to the profile directory. */
	template: string;
	/** Reference copy of the description this variant was written against, also
	 *  relative to the profile directory. Nothing at runtime reads it: it is the
	 *  regression corpus, so `tests/unit-tool-descriptions.mjs` and
	 *  `diag/check-tool-descriptions.mjs` can exercise EVERY variant, including
	 *  the modes this machine's session never renders. */
	original?: string;
}

export interface Profile {
	tool: string;
	/** `{{name}}` in the template → where to lift it from. */
	slots?: Record<string, SlotSource>;
	/** Slots that may be trimmed to fit, in the order they should be SPENT: the
	 *  last one listed is cut first, so a profile declares its priorities by
	 *  ordering rather than by numbers that need re-tuning whenever prose changes. */
	elastic?: string[];
	variants: Variant[];
	/** Absolute directory the profile was loaded from; templates resolve against it. */
	dir: string;
	/** For the debug log, so a user override is distinguishable from a shipped one. */
	source: "builtin" | "override";
}

export type CondenseOutcome =
	/** Under the cap, or condensing is off: forward the original untouched. */
	| { kind: "unchanged" }
	| {
		kind: "condensed";
		text: string;
		from: number;
		to: number;
		variant: string;
		/** Slots that lost units to the budget, for the debug log. */
		trimmed: string[];
	}
	/** Over the cap with no profile shipped for it. Claude Code truncates it. */
	| { kind: "no-profile"; length: number }
	/** A profile exists but does not fit this text, so the original is forwarded
	 *  and truncated. Actionable: it means the profile needs re-authoring. */
	| { kind: "stale"; length: number; reason: string };

export interface CondenseSettings {
	/** False forwards every description as-is; the size warning still fires. */
	condense?: boolean;
	/** Directory of user profiles, each in a `<tool>/` subdirectory. Takes
	 *  precedence over the shipped set per tool, so overriding `eval` does not
	 *  mean re-shipping `read`. */
	overridesDir?: string;
	/** Where `captureLiveDescriptions` writes. Passed in because the agent
	 *  directory is the host's to name, not this module's. */
	captureDir?: string;
}

let settings: CondenseSettings = {};

export function configureToolDescriptions(next: CondenseSettings): void {
	settings = next;
	profiles = null;
	outcomes.clear();
}

// --- Profile loading ---

let profiles: Map<string, Profile> | null = null;

/** Reads one `<root>/<tool>/profile.json`. A profile that does not parse is
 *  skipped with a console warning rather than thrown: a malformed override in
 *  the user's config directory must not stop the bridge from serving the tools
 *  it can still serve. */
function loadProfile(root: string, tool: string, source: Profile["source"]): Profile | null {
	const path = join(root, tool, "profile.json");
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<Profile>;
		if (!Array.isArray(parsed.variants) || parsed.variants.length === 0) throw new Error("no variants");
		for (const variant of parsed.variants) {
			if (!variant?.id || !variant?.template || !Array.isArray(variant.requires)) {
				throw new Error(`variant ${JSON.stringify(variant?.id ?? null)} needs id, template and requires`);
			}
		}
		return { ...parsed, tool, dir: join(root, tool), source } as Profile;
	} catch (e) {
		console.error(`claude-bridge: ignoring tool-description profile ${path}: ${e}`);
		return null;
	}
}

function listToolDirs(root: string): string[] {
	try {
		return readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
	} catch {
		return [];
	}
}

function allProfiles(): Map<string, Profile> {
	if (profiles) return profiles;
	const loaded = new Map<string, Profile>();
	// Shipped first, then overrides on top: a user directory naming only `eval/`
	// replaces that one profile and inherits the rest.
	const roots: Array<[string, Profile["source"]]> = [[BUILTIN_PROFILE_ROOT, "builtin"]];
	if (settings.overridesDir) roots.push([settings.overridesDir, "override"]);
	for (const [root, source] of roots) {
		for (const tool of listToolDirs(root)) {
			const profile = loadProfile(root, tool, source);
			if (profile) loaded.set(tool, profile);
		}
	}
	profiles = loaded;
	return loaded;
}

// --- Slot extraction ---

/** A span lifted out of the live description, split into the units the trimmer
 *  may drop. `head`/`tail` are the delimiters that survive as long as anything
 *  does, so a trimmed `<prelude>` is still a closed block. */
interface Span {
	head: string;
	units: string[];
	tail: string;
	/** True when each unit is a self-contained entry — one agent, one example,
	 *  one API signature with its explanation — rather than a bare line of prose.
	 *  Entries survive being dropped out of the middle; prose does not, so only
	 *  entry spans are packed greedily. */
	grouped?: boolean;
}

const EMPTY_SPAN: Span = { head: "", units: [], tail: "" };

function joinSpan(span: Span, units: string[], elided: number): string {
	if (span.head === "" && units.length === 0 && elided === 0) return "";
	const parts = [...units];
	// Say what was dropped rather than trailing off, for the same reason this
	// module exists: a cut the reader cannot see is the failure mode.
	if (elided > 0) parts.push(`… ${elided} more, trimmed to fit the ${CC_TOOL_DESCRIPTION_CAP}-char tool-description cap`);
	return [span.head, ...parts, span.tail].filter((p) => p !== "").join("\n");
}

function wholeSpan(span: Span): string {
	return joinSpan(span, span.units, 0);
}

function examplesSpan(original: string): Span {
	const match = /^<examples>\n([\s\S]*?)\n<\/examples>$/m.exec(original);
	if (!match) return EMPTY_SPAN;
	// One unit per example, caption line included: splitting by line would cut
	// inside a call and hand the model a syntactically broken example.
	const units = match[1].split(/\n(?=(?:# [^\n]*\n)?<example)/).filter((u) => u !== "");
	return { head: "<examples>", units, tail: "</examples>", grouped: true };
}

function blockSpan(original: string, tag: string): Span {
	const match = new RegExp(`^<${tag}>\\n([\\s\\S]*?)\\n</${tag}>$`, "m").exec(original);
	if (!match) return EMPTY_SPAN;
	const body = match[1].split("\n");
	// An API listing indents its explanation under the signature it explains, so
	// one unit is a signature plus everything indented beneath it. A ``` fence
	// line is unindented and therefore its own unit, which is what keeps a
	// trimmed `<prelude>` balanced: both fences are three characters and survive
	// any budget that admitted the signatures between them.
	const indented = body.some((line) => /^\s+\S/.test(line));
	const units = indented ? groupBy(body, (line) => /^\S/.test(line)) : body;
	return { head: `<${tag}>`, units, tail: `</${tag}>`, grouped: indented };
}

function sectionSpan(original: string, heading: string): Span {
	const level = /^#+/.exec(heading)?.[0].length ?? 0;
	if (level === 0) return EMPTY_SPAN;
	const lines = original.split("\n");
	const start = lines.findIndex((line) => line.trimEnd() === heading);
	if (start === -1) return EMPTY_SPAN;
	const sameOrHigher = new RegExp(`^#{1,${level}} `);
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (sameOrHigher.test(lines[i])) {
			end = i;
			break;
		}
	}
	// The heading is the head — a roster with no title reads as loose prose.
	const body = lines.slice(start + 1, end);
	while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
	// A section built out of sub-headings is a list of entries, so trim it one
	// entry at a time. `# Available Agents` holds a `### <name>` block per agent,
	// and dropping the tail lines of one would leave the model an agent whose
	// name it can pass and whose purpose it cannot read.
	const deeper = new RegExp(`^#{${level + 1},} `);
	const sectioned = body.some((line) => deeper.test(line));
	const units = sectioned ? groupBy(body, (line) => deeper.test(line)) : body;
	return { head: lines[start].trimEnd(), units, tail: "", grouped: sectioned };
}

/** Split lines into chunks, each starting at a line where `isStart` holds. Any
 *  preamble before the first such line stays as its own leading chunk. */
function groupBy(lines: string[], isStart: (line: string) => boolean): string[] {
	const chunks: string[][] = [];
	for (const line of lines) {
		if (chunks.length === 0 || isStart(line)) chunks.push([]);
		chunks[chunks.length - 1].push(line);
	}
	return chunks.map((chunk) => chunk.join("\n").replace(/\n+$/, ""));
}

function lineSpan(original: string, contains: string): Span {
	const line = original.split("\n").find((l) => l.includes(contains));
	return line === undefined ? EMPTY_SPAN : { head: line.trimEnd(), units: [], tail: "" };
}

function spanFor(source: SlotSource, original: string): Span {
	switch (source.from) {
		case "examples":
			return examplesSpan(original);
		case "block":
			return blockSpan(original, source.tag);
		case "section":
			return sectionSpan(original, source.heading);
		case "line":
			return lineSpan(original, source.contains);
		default:
			return EMPTY_SPAN;
	}
}

/** As much of `span` as fits `budget`, delimiters included.
 *
 *  Prose keeps a prefix, because a paragraph with a hole in it is worse than a
 *  paragraph that stops. Entry lists are packed greedily instead: one oversized
 *  entry near the front would otherwise cost every smaller entry behind it, and
 *  `eval`'s prelude is exactly that shape — a 900-character `agent()` block
 *  sitting in front of a dozen one-line signatures.
 *
 *  Returns "" when not even the delimiters plus an elision note fit, so a slot
 *  that cannot be honestly abbreviated disappears instead of half-appearing. */
function fitSpan(span: Span, budget: number): { text: string; trimmed: boolean } {
	const whole = wholeSpan(span);
	if (whole.length <= budget) return { text: whole, trimmed: false };

	if (span.grouped) {
		const kept: string[] = [];
		let dropped = 0;
		for (const unit of span.units) {
			const candidate = [...kept, unit];
			// Cost the elision note into every trial: a pack that only fits once the
			// note is dropped would have to lie about having dropped anything.
			if (joinSpan(span, candidate, dropped + 1).length <= budget) kept.push(unit);
			else dropped++;
		}
		if (kept.length > 0) return { text: joinSpan(span, kept, dropped), trimmed: true };
	}

	for (let keep = span.units.length - 1; keep >= 0; keep--) {
		const text = joinSpan(span, span.units.slice(0, keep), span.units.length - keep);
		if (text.length <= budget) return { text, trimmed: true };
	}
	return { text: "", trimmed: true };
}

// --- Rendering ---

const SLOT = /\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g;

function compose(template: string, values: Map<string, string>): string {
	// An unknown slot renders empty rather than leaving `{{name}}` in the model's
	// prompt, which would read as a rendering bug the model has to interpret.
	return template.replace(SLOT, (_, name: string) => values.get(name) ?? "")
		// Collapse the blank-line runs an emptied slot leaves behind.
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function pickVariant(profile: Profile, original: string): Variant | undefined {
	return profile.variants.find((v) => v.requires.every((marker) => original.includes(marker)));
}

function renderProfile(profile: Profile, original: string): CondenseOutcome {
	const variant = pickVariant(profile, original);
	if (!variant) {
		return {
			kind: "stale",
			length: original.length,
			reason: `no variant matches this text (tried ${profile.variants.map((v) => v.id).join(", ")})`,
		};
	}

	let template: string;
	try {
		template = readFileSync(join(profile.dir, variant.template), "utf-8");
	} catch (e) {
		return { kind: "stale", length: original.length, reason: `cannot read ${variant.template}: ${e}` };
	}

	const spans = new Map<string, Span>();
	const values = new Map<string, string>();
	for (const [name, source] of Object.entries(profile.slots ?? {})) {
		const span = spanFor(source, original);
		spans.set(name, span);
		values.set(name, wholeSpan(span));
	}

	const trimmed: string[] = [];
	for (const name of [...(profile.elastic ?? [])].reverse()) {
		if (compose(template, values).length <= CC_TOOL_DESCRIPTION_CAP) break;
		const span = spans.get(name);
		if (!span) continue;
		// Budget = whatever the cap leaves once everything else is composed at its
		// current (possibly already trimmed) size. One compose per slot, exact.
		const without = new Map(values);
		without.set(name, "");
		const budget = CC_TOOL_DESCRIPTION_CAP - compose(template, without).length;
		const fitted = fitSpan(span, Math.max(0, budget));
		values.set(name, fitted.text);
		if (fitted.trimmed) trimmed.push(name);
	}

	const text = compose(template, values);
	if (text.length === 0) {
		return { kind: "stale", length: original.length, reason: `${variant.id} rendered empty` };
	}
	if (text.length > CC_TOOL_DESCRIPTION_CAP) {
		// Only reachable when the template's own prose is over budget, which is an
		// authoring bug — tests/unit-tool-descriptions.mjs asserts every shipped
		// profile renders under the cap with every slot empty. Forwarding it anyway
		// would hand the model a description truncated mid-sentence while the log
		// claimed it had been condensed.
		return {
			kind: "stale",
			length: original.length,
			reason: `${variant.id} renders ${text.length} chars, over the ${CC_TOOL_DESCRIPTION_CAP} cap`,
		};
	}

	return { kind: "condensed", text, from: original.length, to: text.length, variant: variant.id, trimmed };
}

// --- Public entry ---

// One entry per tool name. Descriptions repeat byte for byte across the turns of
// a session — that is what keeps the prompt cache warm — so keying on the tool
// and re-checking the text is a full hit in the steady state while still
// noticing the session where a setting changed the description under us.
const outcomes = new Map<string, { original: string; outcome: CondenseOutcome }>();

export function condenseDescription(tool: DescribedTool): CondenseOutcome {
	const original = tool.description ?? "";
	const cached = outcomes.get(tool.name);
	if (cached && cached.original === original) return cached.outcome;
	const outcome = computeOutcome(tool.name, original);
	outcomes.set(tool.name, { original, outcome });
	return outcome;
}

function computeOutcome(name: string, original: string): CondenseOutcome {
	if (original.length <= CC_TOOL_DESCRIPTION_CAP) return { kind: "unchanged" };
	if (settings.condense === false) return { kind: "no-profile", length: original.length };
	const profile = allProfiles().get(name);
	if (!profile) return { kind: "no-profile", length: original.length };
	return renderProfile(profile, original);
}

/** What the MCP server should advertise for this tool. */
export function descriptionFor(tool: DescribedTool): string {
	const outcome = condenseDescription(tool);
	return outcome.kind === "condensed" ? outcome.text : (tool.description ?? "");
}

export interface CondenseReport {
	condensed: Array<{ name: string; from: number; to: number; variant: string; trimmed: string[]; drift?: number }>;
	stale: Array<{ name: string; length: number; reason: string }>;
	unprofiled: Array<{ name: string; length: number }>;
}

/** Classify a whole tool list in one pass, for the startup notice. */
export function reportDescriptions(tools: readonly DescribedTool[]): CondenseReport {
	const report: CondenseReport = { condensed: [], stale: [], unprofiled: [] };
	for (const tool of tools) {
		const outcome = condenseDescription(tool);
		if (outcome.kind === "condensed") {
			const variant = allProfiles().get(tool.name)?.variants.find((v) => v.id === outcome.variant);
			// Drift is advisory. OMP's own conditionals move these lengths around per
			// session, so this reports "worth re-reading", never "broken".
			const drift = variant?.verifiedLength ? outcome.from - variant.verifiedLength : undefined;
			report.condensed.push({ ...outcome, name: tool.name, drift });
		} else if (outcome.kind === "stale") {
			report.stale.push({ name: tool.name, length: outcome.length, reason: outcome.reason });
		} else if (outcome.kind === "no-profile") {
			report.unprofiled.push({ name: tool.name, length: outcome.length });
		}
	}
	return report;
}

/** Dump the live descriptions so a profile can be authored against what this
 *  session actually renders rather than against OMP's source markdown, which is
 *  a Handlebars template and never the text the model sees.
 *
 *  Writes into the host's agent directory, not into the installed package: an
 *  extension that edited its own `src/` on a user's machine would silently
 *  diverge from what npm shipped. */
export function captureLiveDescriptions(tools: readonly DescribedTool[]): string | null {
	const dir = settings.captureDir;
	if (!dir) return null;
	mkdirSync(dir, { recursive: true });
	for (const tool of tools) {
		if (!tool.description) continue;
		writeFileSync(join(dir, `${tool.name}.md`), tool.description);
	}
	return dir;
}

/** Test seam: the shipped profiles, so the suite can assert every template holds
 *  its budget without reaching into module state. */
export function loadedProfiles(): ReadonlyMap<string, Profile> {
	return allProfiles();
}

/** Test seam: render one profile against arbitrary text, bypassing the cache. */
export function renderForTest(profile: Profile, original: string): CondenseOutcome {
	return renderProfile(profile, original);
}

/** The reference description a variant was authored against, or null when the
 *  profile ships none. Used by the test suite and the budget checker; never by
 *  the runtime, which only ever sees what the live session renders. */
export function referenceOriginal(profile: Profile, variant: Variant): string | null {
	const name = variant.original ?? "original.md";
	const path = join(profile.dir, name);
	return existsSync(path) ? readFileSync(path, "utf-8") : null;
}
