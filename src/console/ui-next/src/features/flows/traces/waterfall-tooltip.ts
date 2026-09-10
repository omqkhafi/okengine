/**
 * Hover tooltip text for a waterfall bar — kind, resource, duration, start offset.
 */

import { effectEventLabel } from "./effect-summary.ts";
import { formatDuration } from "./format-duration.ts";
import type { WaterfallBar } from "./waterfall-bars.ts";

/**
 * Build the shadcn Tooltip content for one waterfall bar.
 *
 * Format: `{kind label} · {resource} · {duration} · +{start offset}`
 * plus optional egress (`host` / provider / kind) when `external` is set.
 *
 * @param bar - Positioned bar (layout + effect identity)
 */
export function waterfallBarTooltip(
  bar: Pick<WaterfallBar, "kind" | "resource" | "durationMs" | "startOffsetMs" | "external">,
): string {
  const base = `${effectEventLabel(bar)} · ${bar.resource} · ${formatDuration(bar.durationMs)} · +${formatDuration(bar.startOffsetMs)}`;
  if (!bar.external) return base;
  const parts = [bar.external.host];
  if (bar.external.provider) parts.push(bar.external.provider);
  if (bar.external.kind) parts.push(bar.external.kind);
  return `${base} · ↗ ${parts.join(" · ")}`;
}
