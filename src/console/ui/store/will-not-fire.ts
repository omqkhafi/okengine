/**
 * Format Manifest-derived "will not fire" copy for direct-edit confirmation.
 *
 * A direct edit is not a flow execution — name the signals/channels skipped.
 */

import type { WillNotFire } from "./types.ts";

/** Formatted confirmation lines. */
export interface WillNotFireLines {
  readonly headline: string;
  readonly lines: readonly string[];
  readonly empty: boolean;
}

/**
 * Build operator-facing lines naming what will NOT happen on a direct edit.
 *
 * @param willNotFire - Manifest-derived payload
 */
export function formatWillNotFire(willNotFire: WillNotFire): WillNotFireLines {
  const lines: string[] = [];
  for (const signal of willNotFire.signals) {
    lines.push(`Signal \`${signal}\` will not be emitted`);
  }
  for (const channel of willNotFire.channels) {
    lines.push(`Channel \`${channel}\` will not fire`);
  }
  if (willNotFire.writerFlowIds.length > 0) {
    lines.push(
      `Owning flow(s): ${willNotFire.writerFlowIds.map((f) => `\`${f}\``).join(", ")} — not executed`,
    );
  }
  return {
    headline: "Direct edit is not a flow execution — the following will NOT happen:",
    lines,
    empty: lines.length === 0,
  };
}
