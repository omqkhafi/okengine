/**
 * Hover tooltip text for a waterfall bar — kind, resource, duration, start offset.
 */

import { effectEventLabel } from "./effect-summary.ts";
import { formatDuration } from "./format-duration.ts";
import type { WaterfallBar } from "./waterfall-bars.ts";

/**
 * Build the shadcn Tooltip content for one waterfall bar.
 *
 * Format: `{kind label} · {resource} · {duration} · +{start offset}`.
 *
 * @param bar - Positioned bar (layout + effect identity)
 */
export function waterfallBarTooltip(
  bar: Pick<WaterfallBar, "kind" | "resource" | "durationMs" | "startOffsetMs">,
): string {
  return `${effectEventLabel(bar)} · ${bar.resource} · ${formatDuration(bar.durationMs)} · +${formatDuration(bar.startOffsetMs)}`;
}
