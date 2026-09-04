import type { Skill } from "@earendil-works/pi-coding-agent";

export const MCP_SERVER_NAME = "custom-tools";
export const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

export type SkillReadTool = "mcp" | "native" | "none";

/** Renders a host's skill list for a Claude Code turn.
 *
 *  `formatSkills` comes from the host adapter rather than being imported here:
 *  Pi exports `formatSkillsForPrompt`, OMP has no equivalent and renders its own
 *  listing as `skill://` URIs the subprocess cannot open. See src/host.ts. */
export function renderSkillsBlock(
	skills: Skill[],
	readTool: SkillReadTool,
	formatSkills: (skills: Skill[]) => string,
): string | undefined {
	if (readTool === "none" || skills.length === 0) return undefined;
	const block = formatSkills(skills).trim();
	if (!block) return undefined;
	return readTool === "mcp" ? rewriteSkillsBlock(block) : block;
}

export function rewriteSkillsBlock(skillsBlock: string): string {
	return skillsBlock.replace(
		"Use the read tool to load a skill's file",
		`Use the read tool (mcp__${MCP_SERVER_NAME}__read) to load a skill's file`,
	);
}

/** Pi's `formatSkillsForPrompt` wire format, reproduced for hosts that do not
 *  ship it.
 *
 *  The consumer is the Claude Code subprocess, not the host: it needs a name, a
 *  description and an absolute path it can open. OMP renders its own listing as
 *  `skill://<name>` URIs, which the child cannot resolve, so its adapter renders
 *  through here instead and the projection logic on both hosts stays identical.
 *
 *  Visibility is the caller's business — the two hosts spell "hidden from the
 *  model" differently — so everything passed in is rendered. */
export function formatSkillList(skills: SkillListing[]): string {
	if (skills.length === 0) return "";
	const lines = [
		"",
		"",
		"The following skills provide specialized instructions for specific tasks.",
		"Use the read tool to load a skill's file when the task matches its description.",
		"When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
		"",
		"<available_skills>",
	];
	for (const skill of skills) {
		lines.push("  <skill>");
		lines.push(`    <name>${escapeXml(skill.name)}</name>`);
		lines.push(`    <description>${escapeXml(skill.description)}</description>`);
		lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
		lines.push("  </skill>");
	}
	lines.push("</available_skills>");
	return lines.join("\n");
}

export type SkillListing = Pick<Skill, "name" | "description" | "filePath">;

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
