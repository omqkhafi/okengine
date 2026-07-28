/**
 * Causality graph derived from the Manifest (console §9.1).
 *
 * Bidirectional: cause → flows → effects, or effect → flows → causes.
 * Relations are compiler-derived from `fx` and cannot rot.
 */

import type { Effects, Flow, Manifest, Trigger } from "../../../manifest/types.ts";
import {
  hasExternalEffect,
  peakEffectTier,
  tierEffects,
  type TieredEffect,
  type UiEffectTier,
} from "./tiers.ts";

/** A cause shown in the left column. */
export interface CauseNode {
  /** Stable id (`http:POST:/bookings`, `signal:order-placed`, `caller:payments.chargeBooking`). */
  readonly id: string;
  /** Cause kind. */
  readonly kind: "http" | "signal" | "cron" | "every" | "cdc" | "caller";
  /** Human label. */
  readonly label: string;
  /** Flow ids this cause triggers (or calls, for callers). */
  readonly flowIds: readonly string[];
}

/** Centre-column flow row. */
export interface FlowNode {
  /** Flow id (`bookings.create`). */
  readonly id: string;
  /** Unit prefix (`bookings`). */
  readonly unit: string;
  /** Action suffix (`create`). */
  readonly action: string;
  /** Plane. */
  readonly plane: "user" | "operator";
  /** Cause ids that trigger / call this flow. */
  readonly causeIds: readonly string[];
  /** Effect refs this flow touches. */
  readonly effectRefs: readonly string[];
  /** Ranked effect rows. */
  readonly effects: readonly TieredEffect[];
  /** Peak tier for flags / confirmation. */
  readonly peakTier: UiEffectTier | "none";
  /** Has irreversible external effect. */
  readonly external: boolean;
  /** Exception-only flags. */
  readonly flags: {
    readonly durable: boolean;
    readonly live: boolean;
    readonly cached: boolean;
    readonly costsMoney: boolean;
    readonly readsSecret: boolean;
    readonly touchesPii: boolean;
    readonly external: boolean;
  };
  /** Declared input schema (object form when available). */
  readonly inSchema: Record<string, unknown> | null;
  /** Declared output schema. */
  readonly outSchema: Record<string, unknown> | null;
  /** Typed error names. */
  readonly errorNames: readonly string[];
  /** Source deep-link. */
  readonly source: string | undefined;
  /** Deprecation marker. */
  readonly deprecated: boolean;
  /** Raw Manifest flow. */
  readonly raw: Flow;
}

/** An effect / resource in the right column (or idle inventory). */
export interface EffectNode {
  /** Resource ref (`sql:bookings`, `signal:order-placed`, `channel:booking-confirmed`). */
  readonly ref: string;
  /** Display tier. */
  readonly tier: UiEffectTier;
  /** Flow ids that touch this resource. */
  readonly flowIds: readonly string[];
  /** Touch count (= flowIds.length). */
  readonly touchCount: number;
  /** Fan-out for signals. */
  readonly fanOut: number;
}

/** Full causality index for one Manifest. */
export interface CausalityGraph {
  readonly causes: readonly CauseNode[];
  readonly flows: readonly FlowNode[];
  readonly effects: readonly EffectNode[];
  readonly causeById: ReadonlyMap<string, CauseNode>;
  readonly flowById: ReadonlyMap<string, FlowNode>;
  readonly effectByRef: ReadonlyMap<string, EffectNode>;
}

/**
 * Unit of a flow id (`bookings.create` → `bookings`).
 *
 * @param flowId - Flow id
 */
export function unitOf(flowId: string): string {
  const i = flowId.indexOf(".");
  return i === -1 ? flowId : flowId.slice(0, i);
}

/**
 * Action of a flow id (`bookings.create` → `create`).
 *
 * @param flowId - Flow id
 */
export function actionOf(flowId: string): string {
  const i = flowId.indexOf(".");
  return i === -1 ? flowId : flowId.slice(i + 1);
}

/**
 * Stable cause id from a trigger or caller.
 *
 * @param trigger - Flow trigger
 * @param flowId - Owning flow (for caller fallback)
 * @param callers - Flows that call this one
 */
export function causeIdsFor(
  trigger: Trigger | undefined,
  flowId: string,
  callers: readonly string[],
): CauseNode[] {
  const nodes: CauseNode[] = [];
  if (trigger?.http) {
    const id = `http:${trigger.http.method}:${trigger.http.path}`;
    nodes.push({
      id,
      kind: "http",
      label: `${trigger.http.method} ${trigger.http.path}`,
      flowIds: [flowId],
    });
  }
  if (trigger?.signal) {
    nodes.push({
      id: `signal:${trigger.signal}`,
      kind: "signal",
      label: trigger.signal,
      flowIds: [flowId],
    });
  }
  if (trigger?.cron) {
    nodes.push({
      id: `cron:${trigger.cron}`,
      kind: "cron",
      label: trigger.cron,
      flowIds: [flowId],
    });
  }
  if (trigger?.every) {
    nodes.push({
      id: `every:${trigger.every}`,
      kind: "every",
      label: `every ${trigger.every}`,
      flowIds: [flowId],
    });
  }
  if (trigger?.cdc) {
    const col = trigger.cdc.column ? `.${trigger.cdc.column}` : "";
    const id = `cdc:${trigger.cdc.table}${col}`;
    nodes.push({
      id,
      kind: "cdc",
      label: `cdc ${trigger.cdc.table}${col}`,
      flowIds: [flowId],
    });
  }
  if (nodes.length === 0) {
    for (const caller of callers) {
      nodes.push({
        id: `caller:${caller}`,
        kind: "caller",
        label: caller,
        flowIds: [flowId],
      });
    }
  }
  return nodes;
}

/**
 * Flatten effect refs with kind prefixes for inventory keys.
 *
 * @param effects - Flow effects
 */
export function effectRefsOf(effects: Effects | undefined): string[] {
  if (!effects) return [];
  const refs: string[] = [];
  for (const r of effects.reads ?? []) refs.push(r);
  for (const r of effects.writes ?? []) refs.push(r);
  for (const r of effects.emits ?? []) refs.push(`signal:${r}`);
  for (const r of effects.sends ?? []) refs.push(`channel:${r}`);
  for (const r of effects.asks ?? []) refs.push(`ai:${r}`);
  for (const r of effects.secrets ?? []) refs.push(`secret:${r}`);
  for (const r of effects.calls ?? []) refs.push(`flow:${r}`);
  return refs;
}

function schemaObject(
  schema: string | Record<string, unknown> | undefined,
): Record<string, unknown> | null {
  if (!schema || typeof schema === "string") return null;
  return schema;
}

function errorNamesOf(flow: Flow): string[] {
  if (!flow.errors) return [];
  if (Array.isArray(flow.errors)) return [...flow.errors];
  return Object.keys(flow.errors);
}

/**
 * Build the causality graph from a Manifest snapshot.
 *
 * @param manifest - Manifest (or null → empty graph)
 */
export function buildCausalityGraph(manifest: Manifest | null | undefined): CausalityGraph {
  const flowsMap = manifest?.flows ?? {};
  const flowIds = Object.keys(flowsMap).sort();

  // Reverse index: callee → callers
  const callersOf = new Map<string, string[]>();
  for (const id of flowIds) {
    const calls = flowsMap[id]?.effects?.calls ?? [];
    for (const callee of calls) {
      const list = callersOf.get(callee) ?? [];
      list.push(id);
      callersOf.set(callee, list);
    }
  }

  // Signal consumers (fan-out)
  const signalConsumers = new Map<string, string[]>();
  for (const id of flowIds) {
    const sig = flowsMap[id]?.trigger?.signal;
    if (!sig) continue;
    const list = signalConsumers.get(sig) ?? [];
    list.push(id);
    signalConsumers.set(sig, list);
  }

  const causeMerge = new Map<string, CauseNode>();
  const effectMerge = new Map<string, { tier: UiEffectTier; flowIds: string[]; fanOut: number }>();
  const flowNodes: FlowNode[] = [];

  for (const id of flowIds) {
    const raw = flowsMap[id];
    if (!raw) continue;
    const callers = callersOf.get(id) ?? [];
    const causes = causeIdsFor(raw.trigger, id, callers);
    for (const c of causes) {
      const existing = causeMerge.get(c.id);
      if (existing) {
        causeMerge.set(c.id, {
          ...existing,
          flowIds: [...new Set([...existing.flowIds, id])],
        });
      } else {
        causeMerge.set(c.id, c);
      }
    }

    const touchCounts = new Map<string, number>();
    const emitFanOut = new Map<string, number>();
    for (const sig of raw.effects?.emits ?? []) {
      emitFanOut.set(sig, signalConsumers.get(sig)?.length ?? 0);
    }

    const tiered = tierEffects(raw.effects, { touchCounts, emitFanOut });
    const refs = effectRefsOf(raw.effects);

    for (const row of tiered) {
      const key =
        row.kind === "emit"
          ? `signal:${row.ref}`
          : row.kind === "send"
            ? `channel:${row.ref}`
            : row.kind === "ask"
              ? `ai:${row.ref}`
              : row.kind === "secret"
                ? `secret:${row.ref}`
                : row.kind === "call"
                  ? `flow:${row.ref}`
                  : row.ref;
      const existing = effectMerge.get(key);
      if (existing) {
        existing.flowIds.push(id);
        existing.fanOut = Math.max(existing.fanOut, row.fanOut ?? 0);
      } else {
        effectMerge.set(key, {
          tier: row.tier,
          flowIds: [id],
          fanOut: row.fanOut ?? 0,
        });
      }
    }

    // Also index store tables declared but maybe only read via classification
    flowNodes.push({
      id,
      unit: unitOf(id),
      action: actionOf(id),
      plane: raw.plane ?? "user",
      causeIds: causes.map((c) => c.id),
      effectRefs: refs,
      effects: tiered,
      peakTier: peakEffectTier(raw.effects),
      external: hasExternalEffect(raw.effects),
      flags: {
        durable: raw.durable === true,
        live: raw.live === true,
        cached: raw.cache !== undefined && raw.cache !== false,
        costsMoney: (raw.cost?.estimatePerCall ?? 0) > 0,
        readsSecret: (raw.effects?.secrets?.length ?? 0) > 0,
        touchesPii: raw.pii !== undefined || raw.allowPii === true,
        external: hasExternalEffect(raw.effects),
      },
      inSchema: schemaObject(raw.in),
      outSchema: schemaObject(raw.out),
      errorNames: errorNamesOf(raw),
      source: raw.source,
      deprecated: Boolean(raw.deprecated),
      raw,
    });
  }

  // Idle inventory: also include declared stores / signals / channels / vault / ai
  if (manifest?.stores) {
    for (const store of Object.values(manifest.stores)) {
      if (store.facet === "sql" && store.tables) {
        for (const table of Object.keys(store.tables)) {
          const ref = `sql:${table}`;
          if (!effectMerge.has(ref)) {
            effectMerge.set(ref, { tier: "reads", flowIds: [], fanOut: 0 });
          }
        }
      }
    }
  }
  if (manifest?.signals) {
    for (const name of Object.keys(manifest.signals)) {
      const ref = `signal:${name}`;
      if (!effectMerge.has(ref)) {
        effectMerge.set(ref, { tier: "emits", flowIds: [], fanOut: 0 });
      }
    }
  }
  if (manifest?.channels) {
    for (const name of Object.keys(manifest.channels)) {
      const ref = `channel:${name}`;
      if (!effectMerge.has(ref)) {
        effectMerge.set(ref, { tier: "external", flowIds: [], fanOut: 0 });
      }
    }
  }
  if (manifest?.vault) {
    for (const name of Object.keys(manifest.vault)) {
      const ref = `secret:${name}`;
      if (!effectMerge.has(ref)) {
        effectMerge.set(ref, {
          tier: "capabilities",
          flowIds: [],
          fanOut: 0,
        });
      }
    }
  }

  const causes = [...causeMerge.values()].sort((a, b) => a.label.localeCompare(b.label));
  const effects: EffectNode[] = [...effectMerge.entries()]
    .map(([ref, v]) => ({
      ref,
      tier: v.tier,
      flowIds: [...new Set(v.flowIds)].sort(),
      touchCount: new Set(v.flowIds).size,
      fanOut: v.fanOut,
    }))
    .sort((a, b) => b.touchCount - a.touchCount || a.ref.localeCompare(b.ref));

  const causeById = new Map(causes.map((c) => [c.id, c]));
  const flowById = new Map(flowNodes.map((f) => [f.id, f]));
  const effectByRef = new Map(effects.map((e) => [e.ref, e]));

  return {
    causes,
    flows: flowNodes,
    effects,
    causeById,
    flowById,
    effectByRef,
  };
}

/**
 * Flows visible in the centre column given the current selection.
 * Dim-never-hide: returns all flows with a `match` flag.
 *
 * @param graph - Causality graph
 * @param selection - Selection kind + ids
 * @param query - Free-text filter
 */
export function centreFlows(
  graph: CausalityGraph,
  selection: {
    readonly sel: "none" | "cause" | "flow" | "effect";
    readonly cause?: string;
    readonly flow?: string;
    readonly effect?: string;
    readonly q?: string;
    readonly unit?: string;
  },
): Array<FlowNode & { readonly match: boolean; readonly related: boolean }> {
  let relatedIds: Set<string> | null = null;

  if (selection.sel === "cause" && selection.cause) {
    const cause = graph.causeById.get(selection.cause);
    relatedIds = new Set(cause?.flowIds ?? []);
  } else if (selection.sel === "effect" && selection.effect) {
    const effect = graph.effectByRef.get(selection.effect);
    relatedIds = new Set(effect?.flowIds ?? []);
  } else if (selection.sel === "flow" && selection.flow) {
    relatedIds = new Set([selection.flow]);
  }

  return graph.flows.map((f) => {
    const related = relatedIds === null ? true : relatedIds.has(f.id);
    const textMatch = matchesFlowQuery(f, selection.q);
    const unitMatch = !selection.unit || f.unit === selection.unit;
    const match = related && textMatch && unitMatch;
    return { ...f, match, related };
  });
}

/**
 * Causes for the left column given selection.
 *
 * @param graph - Graph
 * @param selection - Selection
 * @param query - Filter
 */
export function leftCauses(
  graph: CausalityGraph,
  selection: {
    readonly sel: "none" | "cause" | "flow" | "effect";
    readonly flow?: string;
    readonly effect?: string;
    readonly q?: string;
  },
): Array<CauseNode & { readonly match: boolean; readonly related: boolean }> {
  let relatedIds: Set<string> | null = null;

  if (selection.sel === "flow" && selection.flow) {
    const flow = graph.flowById.get(selection.flow);
    relatedIds = new Set(flow?.causeIds ?? []);
  } else if (selection.sel === "effect" && selection.effect) {
    const effect = graph.effectByRef.get(selection.effect);
    const causeIds = new Set<string>();
    for (const fid of effect?.flowIds ?? []) {
      const flow = graph.flowById.get(fid);
      for (const c of flow?.causeIds ?? []) causeIds.add(c);
    }
    relatedIds = causeIds;
  }

  return graph.causes.map((c) => {
    const related = relatedIds === null ? true : relatedIds.has(c.id);
    const textMatch =
      !selection.q ||
      c.label.toLowerCase().includes(selection.q.toLowerCase()) ||
      c.id.toLowerCase().includes(selection.q.toLowerCase());
    return { ...c, match: related && textMatch, related };
  });
}

/**
 * Effects for the right column given selection.
 *
 * @param graph - Graph
 * @param selection - Selection
 * @param query - Filter
 * @param hideUbiquitous - Filter high-touch resources from prominence
 * @param ubiquitousThreshold - Touch-count threshold
 */
export function rightEffects(
  graph: CausalityGraph,
  selection: {
    readonly sel: "none" | "cause" | "flow" | "effect";
    readonly cause?: string;
    readonly flow?: string;
    readonly q?: string;
  },
  options: {
    readonly hideUbiquitous?: boolean;
    readonly ubiquitousThreshold?: number;
  } = {},
): Array<EffectNode & { readonly match: boolean; readonly related: boolean }> {
  let relatedIds: Set<string> | null = null;

  if (selection.sel === "flow" && selection.flow) {
    const flow = graph.flowById.get(selection.flow);
    relatedIds = new Set(flow?.effectRefs ?? []);
  } else if (selection.sel === "cause" && selection.cause) {
    const cause = graph.causeById.get(selection.cause);
    const refs = new Set<string>();
    for (const fid of cause?.flowIds ?? []) {
      const flow = graph.flowById.get(fid);
      for (const r of flow?.effectRefs ?? []) refs.add(r);
    }
    relatedIds = refs;
  }

  const threshold = options.ubiquitousThreshold ?? 8;

  return graph.effects.map((e) => {
    const related = relatedIds === null ? true : relatedIds.has(e.ref);
    const textMatch = !selection.q || e.ref.toLowerCase().includes(selection.q.toLowerCase());
    const ubiquityOk = !options.hideUbiquitous || e.touchCount < threshold || relatedIds !== null;
    return {
      ...e,
      match: related && textMatch && ubiquityOk,
      related,
    };
  });
}

function matchesFlowQuery(flow: FlowNode, q: string | undefined): boolean {
  if (!q?.trim()) return true;
  const needle = q.toLowerCase();
  return (
    flow.id.toLowerCase().includes(needle) ||
    flow.unit.toLowerCase().includes(needle) ||
    flow.action.toLowerCase().includes(needle)
  );
}
