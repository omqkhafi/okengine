/**
 * EffectKind presentation for the trace detail Sheet.
 *
 * Kernel {@link EffectKind} values (singular): read · write · emit · send ·
 * ask · secret · call. Graph edge strokes use the plural Manifest keys
 * (reads/writes/emits/calls/asks) — map through {@link effectBarColor}.
 * Icons reuse the same eight-element HugeIcons vocabulary as Flow graph
 * nodes (store / signal / flow / ai / channel / vault).
 */

import type { RunEffect } from "@/client.ts";
import { ELEMENT_ICONS, type ElementHugeIcon } from "@/lib/element-icons.ts";
import { EDGE_STROKE } from "../graph/flow-graph-theme.ts";

/** Kernel effect kinds on a projected run row. */
export type RunEffectKind = RunEffect["kind"];

/** Human singular label for an effect kind (event-detail rows). */
export const EFFECT_KIND_LABEL: Readonly<Record<RunEffectKind, string>> = {
  read: "Read",
  write: "Write",
  emit: "Emit",
  send: "Send",
  ask: "Ask",
  secret: "Secret",
  call: "Call",
};

/**
 * Plural summary noun for an effect kind count chip.
 *
 * @param kind - Effect kind
 * @param count - Occurrences in the ledger
 */
export function effectKindSummaryLabel(kind: RunEffectKind, count: number): string {
  const singular: Record<RunEffectKind, string> = {
    read: "read",
    write: "write",
    emit: "emit",
    send: "send",
    ask: "ask",
    secret: "secret",
    call: "call",
  };
  const plural: Record<RunEffectKind, string> = {
    read: "reads",
    write: "writes",
    emit: "emits",
    send: "sends",
    ask: "asks",
    secret: "secrets",
    call: "calls",
  };
  return `${count} ${count === 1 ? singular[kind] : plural[kind]}`;
}

/**
 * Waterfall / event-row color for an effect kind.
 *
 * Reuses {@link EDGE_STROKE} for reads/writes/emits/calls/asks. `send` and
 * `secret` have no graph-edge counterpart — distinct but related hues so the
 * Sheet stays consistent without inventing fake edge kinds.
 *
 * @param kind - Effect kind
 */
export function effectBarColor(kind: RunEffectKind): string {
  switch (kind) {
    case "read":
      return EDGE_STROKE.reads;
    case "write":
      return EDGE_STROKE.writes;
    case "emit":
      return EDGE_STROKE.emits;
    case "call":
      return EDGE_STROKE.calls;
    case "ask":
      return EDGE_STROKE.asks;
    case "send":
      return "#C084FC";
    case "secret":
      return "#94A3B8";
  }
}

/**
 * HugeIcon for an effect kind — same element glyphs the Flow graph uses for
 * the corresponding edge target (store / signal / flow / ai), plus channel
 * and vault for send / secret.
 *
 * @param kind - Effect kind
 */
export function effectKindIcon(kind: RunEffectKind): ElementHugeIcon {
  switch (kind) {
    case "read":
    case "write":
      return ELEMENT_ICONS.store.icon;
    case "emit":
      return ELEMENT_ICONS.signal.icon;
    case "call":
      return ELEMENT_ICONS.flow.icon;
    case "ask":
      return ELEMENT_ICONS.ai.icon;
    case "send":
      return ELEMENT_ICONS.channel.icon;
    case "secret":
      return ELEMENT_ICONS.vault.icon;
  }
}
