// Pure quota formatters, split from index.ts so tests can import them without
// activating the extension. Rendered only from streamed rate_limit_events, so
// windows the account never hits are simply absent, not blanked.

import type { SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk";

export type UsageSample = SDKRateLimitInfo & { capturedAt: number };
export type UsageWindows = Map<string, UsageSample>;

const WINDOW_LABELS: Record<string, string> = {
	five_hour: "5-hour",
	seven_day: "weekly",
	seven_day_opus: "weekly Opus",
	seven_day_sonnet: "weekly Sonnet",
};
const WINDOW_ORDER = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"];

const BAR_WIDTH = 20;

function windowLabel(key: string): string {
	return WINDOW_LABELS[key] ?? key;
}

// "overage" is a status flag, not a quota window, so it gets no bar.
function quotaWindowKeys(windows: UsageWindows): string[] {
	return [...windows.keys()]
		.filter((k) => k !== "overage")
		.sort((a, b) => {
			const ai = WINDOW_ORDER.indexOf(a);
			const bi = WINDOW_ORDER.indexOf(b);
			return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
		});
}

// resetsAt is Unix seconds, not milliseconds: passing it to Date unscaled
// dates every window to January 1970.
// The SDK reports utilization as a fraction (0.98 at 98% of the window), so it
// has to be scaled before it is rounded — rounding it directly prints "1% used"
// against a nearly spent quota.
export function utilizationPercent(sample: Pick<UsageSample, "utilization">): number {
	return Math.round((sample.utilization ?? 0) * 100);
}

export function formatResetTime(ts?: number): string {
	if (!ts) return "unknown";
	return new Date(ts * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function anyExtraUsageActive(windows: UsageWindows): boolean {
	return [...windows.values()].some((w) => w.isUsingOverage);
}

export function formatQuotaStatus(windows: UsageWindows): string | undefined {
	const five = windows.get("five_hour");
	if (!five) return undefined;
	let s = `CC 5h ${utilizationPercent(five)}%`;
	if (anyExtraUsageActive(windows)) s += " \u26A0extra";
	return s;
}

export function usageBar(pct: number, width = BAR_WIDTH): string {
	const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
	return "\u2593".repeat(filled) + "\u2591".repeat(width - filled);
}

export function formatUsageReport(windows: UsageWindows): string {
	const keys = quotaWindowKeys(windows);
	if (keys.length === 0) {
		return "Claude usage: no data yet \u2014 send a message through the bridge first.";
	}
	const labelWidth = Math.max(...keys.map((k) => windowLabel(k).length));
	const lines = ["Plan quota", ""];
	for (const key of keys) {
		const w = windows.get(key)!;
		const pct = utilizationPercent(w);
		const label = windowLabel(key).padEnd(labelWidth);
		lines.push(`  ${label}  ${usageBar(pct)}  ${String(pct).padStart(3)}%  resets ${formatResetTime(w.resetsAt)}`);
		lines.push("");
	}
	lines.push(`  Extra Usage: ${anyExtraUsageActive(windows) ? "in use" : "not in use"}`);
	// Spend amount and per-model limits are not in the stream; only Claude Code has them.
	lines.push("  For exact credit spend and per-model limits: run `claude` then /usage");
	return lines.join("\n");
}
