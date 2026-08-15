/**
 * Module:Action pairs — derived from the Manifest, never hand-written.
 *
 * Every flow belongs to a unit and has a name, so `bookings:create` exists
 * automatically. Console permissions are ordinary pairs (`console:store.sql:write`).
 *
 * @see docs/spec/console.md §3.1
 */

import type { Manifest } from "../../manifest/types.ts";

/** Built-in pairs that are not flow-derived. */
const BUILTIN_PAIRS: readonly string[] = [
  "pii:reveal",
  "console:flows:invoke-as",
  "console:store.sql:read",
  "console:store.sql:write",
  "console:signals:replay",
  "console:signals:purge",
  "store.sql:read",
  "store.sql:write",
  "store.kv:read",
  "store.kv:write",
  "signals:replay",
  "vault:read",
];

/**
 * Derive every Module:Action pair from a Manifest.
 *
 * @param manifest - Extracted Manifest
 * @returns Sorted unique pairs
 */
export function deriveModuleActions(manifest: Manifest): string[] {
  const pairs = new Set<string>(BUILTIN_PAIRS);

  for (const [flowId, flow] of Object.entries(manifest.flows ?? {})) {
    const action = flowIdToAction(flowId);
    pairs.add(action);
    if (flow.plane === "operator" && !action.startsWith("console:")) {
      pairs.add(`console:${action}`);
    }
    for (const gate of flow.gates ?? []) {
      if (gate.includes(":") && !gate.startsWith("rate:")) {
        pairs.add(gate);
      }
    }
  }

  for (const [gateId, gate] of Object.entries(manifest.gates ?? {})) {
    if (gate.kind === "all") continue;
    if (gate.kind === "policy" || gateId.includes(":")) {
      if (!gateId.startsWith("rate:")) pairs.add(gateId);
    }
    for (const scope of gate.scopes ?? []) pairs.add(scope);
  }

  for (const read of collectEffects(manifest, "reads")) {
    pairs.add(effectToAction(read, "read"));
  }
  for (const write of collectEffects(manifest, "writes")) {
    pairs.add(effectToAction(write, "write"));
  }

  return [...pairs].sort((a, b) => a.localeCompare(b));
}

/**
 * Convert a flow id (`bookings.create` / `console.store.query`) to a pair.
 *
 * @param flowId - Dot-separated flow id
 */
export function flowIdToAction(flowId: string): string {
  const i = flowId.indexOf(".");
  if (i === -1) return flowId;
  return `${flowId.slice(0, i)}:${flowId.slice(i + 1)}`;
}

function effectToAction(ref: string, op: "read" | "write"): string {
  // `sql:bookings` → `store.sql:read`
  const facet = ref.split(":")[0] ?? ref;
  return `store.${facet}:${op}`;
}

function collectEffects(manifest: Manifest, kind: "reads" | "writes"): string[] {
  const out: string[] = [];
  for (const flow of Object.values(manifest.flows ?? {})) {
    const list = flow.effects?.[kind];
    if (list) out.push(...list);
  }
  return out;
}

/**
 * Format pairs for `oke gates list` stdout.
 *
 * @param pairs - Module:Action pairs
 */
export function formatGatesList(pairs: readonly string[]): string {
  if (pairs.length === 0) return "(no Module:Action pairs)\n";
  return pairs.map((p) => p).join("\n") + "\n";
}
