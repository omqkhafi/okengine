/**
 * Overview map — radial hub, not a column of units.
 *
 * Center is the law (OKE). Eight element discs sit on the inner orbit.
 * Each element's kinds cluster on that element's spoke (Store
 * SQL/KV/Files/Index, Gate policy/scope/rate/flag, …) — not a shared
 * second ring. Units sit on the outer ring. Couplings run unit → type
 * → element → law. Live heat comes from the Traces ledger.
 */

import type { Edge } from "@xyflow/react";
import type { Flow, Gate, Manifest, SecretContract } from "../../../../../../manifest/types.ts";
import type { RunRow } from "@/client.ts";
import { ELEMENT_ICONS, type OkeElement } from "@/lib/element-icons.ts";
import {
  FLOW_TRIGGER_KIND_SPECS,
  FLOW_TRIGGER_KINDS,
  flowTriggerKind,
} from "@/features/units/lib/flow-trigger.ts";
import {
  actionOfFlowId,
  unitOfFlowId,
  type FlowGraphEdge,
  type FlowGraphNode,
} from "./build-flow-graph.ts";
import {
  EDGE_STROKE,
  GRAPH_Z,
  HUB_LAYOUT,
  MAP_BOX,
  NODE_ACCENT,
  NODE_BOX,
} from "./flow-graph-theme.ts";

/** Manifesto order — the eight elements, always. */
export const OKE_ELEMENTS: readonly OkeElement[] = [
  "flow",
  "signal",
  "store",
  "clock",
  "gate",
  "vault",
  "channel",
  "ai",
];

/** One bundled unit → element coupling. */
export type ElementCoupling = {
  readonly unit: string;
  readonly element: OkeElement;
  readonly flowCount: number;
};

/** Unit row on the overview map. */
export type UnitMapRow = {
  readonly unit: string;
  readonly flowCount: number;
  readonly elements: readonly OkeElement[];
  readonly live: number;
  readonly errors: number;
};

/** Element hub on the overview map. */
export type ElementHubRow = {
  readonly element: OkeElement;
  readonly resourceCount: number;
  readonly flowCount: number;
  readonly live: number;
  readonly errors: number;
};

/** A resource leaf shown when an element hub is focused. */
export type ElementResource = {
  readonly id: string;
  readonly label: string;
  readonly badge?: string;
};

/**
 * Polar top-left for a box centered on a ring.
 *
 * @param angle - Radians, 0 = east, −π/2 = north
 * @param radius - Ring radius
 * @param box - Node box
 */
export function radialPoint(
  angle: number,
  radius: number,
  box: { readonly width: number; readonly height: number },
): { readonly x: number; readonly y: number } {
  return {
    x: HUB_LAYOUT.cx + radius * Math.cos(angle) - box.width / 2,
    y: HUB_LAYOUT.cy + radius * Math.sin(angle) - box.height / 2,
  };
}

/**
 * Evenly spaced ring angles starting at 12 o'clock.
 *
 * @param count - Slots
 */
export function ringAngles(count: number): readonly number[] {
  if (count <= 0) return [];
  const step = (2 * Math.PI) / count;
  return Array.from({ length: count }, (_, i) => -Math.PI / 2 + i * step);
}

const ELEMENT_SECTOR = (2 * Math.PI) / OKE_ELEMENTS.length;

/**
 * Fan `count` angles around a home heading, packed to chip width.
 *
 * @param home - Element disc angle
 * @param count - Types in this row
 * @param radius - Row radius (for chip spacing)
 */
export function fanAngles(
  home: number,
  count: number,
  radius: number = HUB_LAYOUT.typeRing,
): readonly number[] {
  if (count <= 0) return [];
  if (count === 1) return [home];
  const step = (MAP_BOX.type.width + 10) / radius;
  const span = Math.min(step * (count - 1), ELEMENT_SECTOR * 0.7);
  return Array.from({ length: count }, (_, i) => home - span / 2 + (i / (count - 1)) * span);
}

/** Polar slot for one type chip in an element's cluster. */
export type TypeSlot = {
  readonly angle: number;
  readonly radius: number;
};

/**
 * Compact cluster on an element's spoke — one row for ≤3 kinds, two
 * rows for the rest, so types stay with their parent instead of
 * smearing around a shared ring.
 *
 * @param home - Element disc angle
 * @param count - Types in this cluster
 */
export function typeClusterSlots(home: number, count: number): readonly TypeSlot[] {
  if (count <= 0) return [];
  const near = HUB_LAYOUT.typeRing;
  const far = HUB_LAYOUT.typeRing + HUB_LAYOUT.typeRow;
  if (count === 1) return [{ angle: home, radius: near }];
  if (count === 4) return typeGrid2x2(home, near, far);
  if (count <= 3) {
    return fanAngles(home, count, near).map((angle) => ({ angle, radius: near }));
  }
  const innerCount = Math.ceil(count / 2);
  const outerCount = count - innerCount;
  return [
    ...fanAngles(home, innerCount, near).map((angle) => ({ angle, radius: near })),
    ...fanAngles(home, outerCount, far).map((angle) => ({ angle, radius: far })),
  ];
}

/**
 * Chip size along the tangent at `home` — height at east/west (Store,
 * Channel), width at north/south (Flow, Gate) so a 2×2 does not overlap.
 *
 * @param home - Element disc angle
 */
function tangentChipSize(home: number): number {
  return (
    Math.abs(Math.cos(home)) * MAP_BOX.type.height + Math.abs(Math.sin(home)) * MAP_BOX.type.width
  );
}

/** 2×2 on the spoke — Store / Channel / Gate / AI. Spaced by chip box. */
function typeGrid2x2(home: number, near: number, far: number): readonly TypeSlot[] {
  const step = (tangentChipSize(home) + 24) / near;
  return [
    { angle: home - step / 2, radius: near },
    { angle: home + step / 2, radius: near },
    { angle: home - step / 2, radius: far },
    { angle: home + step / 2, radius: far },
  ];
}

/**
 * Elements a flow declares — trigger, gates, and effects.
 *
 * `flow` is always present. `calls` stay inside flow (they do not add a
 * second element).
 *
 * @param flow - Manifest flow
 */
export function elementsOfFlow(flow: Flow): readonly OkeElement[] {
  const out = new Set<OkeElement>(["flow"]);
  const trigger = flow.trigger;
  if (trigger?.cron || trigger?.every) out.add("clock");
  if (trigger?.signal) out.add("signal");
  if ((flow.gates?.length ?? 0) > 0) out.add("gate");
  const effects = flow.effects;
  if ((effects?.reads?.length ?? 0) > 0 || (effects?.writes?.length ?? 0) > 0) {
    out.add("store");
  }
  if ((effects?.emits?.length ?? 0) > 0) out.add("signal");
  if ((effects?.sends?.length ?? 0) > 0) out.add("channel");
  if ((effects?.asks?.length ?? 0) > 0) out.add("ai");
  if ((effects?.secrets?.length ?? 0) > 0) out.add("vault");
  return OKE_ELEMENTS.filter((element) => out.has(element));
}

/**
 * Elements a run actually touched (ledger, not Manifest).
 *
 * @param run - Projected run row
 */
export function elementsOfRun(run: RunRow): readonly OkeElement[] {
  const out = new Set<OkeElement>(["flow"]);
  if (run.trigger === "cron" || run.trigger === "every") out.add("clock");
  if (run.trigger === "signal") out.add("signal");
  if (run.gates.length > 0) out.add("gate");
  for (const effect of run.effects) {
    switch (effect.kind) {
      case "read":
      case "write":
        out.add("store");
        break;
      case "emit":
        out.add("signal");
        break;
      case "send":
        out.add("channel");
        break;
      case "ask":
        out.add("ai");
        break;
      case "secret":
        out.add("vault");
        break;
      case "call":
        break;
    }
  }
  return OKE_ELEMENTS.filter((element) => out.has(element));
}

/**
 * Unique resources an element owns — catalogue plus declared effect refs.
 *
 * @param manifest - Live Manifest
 * @param element - Element to list
 */
export function resourcesOfElement(
  manifest: Manifest,
  element: OkeElement,
): readonly ElementResource[] {
  const byId = new Map<string, ElementResource>();
  const add = (id: string, label: string, badge?: string) => {
    if (byId.has(id)) return;
    byId.set(id, badge !== undefined ? { id, label, badge } : { id, label });
  };

  switch (element) {
    case "flow":
      for (const flowId of Object.keys(manifest.flows ?? {}).sort()) {
        add(`flow:${flowId}`, actionOfFlowId(flowId), unitOfFlowId(flowId));
      }
      break;
    case "signal":
      for (const name of Object.keys(manifest.signals ?? {}).sort()) {
        add(`signal:${name}`, name, "signal");
      }
      for (const flow of Object.values(manifest.flows ?? {})) {
        if (flow.trigger?.signal)
          add(`signal:${flow.trigger.signal}`, flow.trigger.signal, "signal");
        for (const name of flow.effects?.emits ?? []) add(`signal:${name}`, name, "signal");
      }
      break;
    case "store":
      for (const [storeName, store] of Object.entries(manifest.stores ?? {})) {
        const facet = store.facet;
        for (const table of Object.keys(store.tables ?? {}).sort()) {
          add(`${facet}:${table}`, table, facet);
        }
        const namespaces = store.namespaces && store.namespaces.length > 0 ? store.namespaces : [];
        if (facet === "kv" && namespaces.length === 0) add(`kv:${storeName}`, storeName, "kv");
        for (const name of [...namespaces].sort()) add(`kv:${name}`, name, "kv");
        for (const name of [...(store.buckets ?? [])].sort()) add(`files:${name}`, name, "files");
        for (const name of [...(store.indexes ?? [])].sort()) add(`index:${name}`, name, "index");
      }
      for (const flow of Object.values(manifest.flows ?? {})) {
        for (const ref of [...(flow.effects?.reads ?? []), ...(flow.effects?.writes ?? [])]) {
          const spec = storeRefSpec(ref);
          if (spec) add(spec.id, spec.label, spec.badge);
        }
      }
      break;
    case "clock":
      for (const [name, clock] of Object.entries(manifest.clocks ?? {}).sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        add(`clock:${name}`, name, clock.cron ? "cron" : clock.every ? "every" : "clock");
      }
      for (const [flowId, flow] of Object.entries(manifest.flows ?? {})) {
        if (flow.trigger?.cron) add(`clock:${flowId}`, flow.trigger.cron, "cron");
        if (flow.trigger?.every) add(`clock:${flowId}`, flow.trigger.every, "every");
      }
      break;
    case "gate":
      for (const name of Object.keys(manifest.gates ?? {}).sort()) {
        add(`gate:${name}`, name, "gate");
      }
      for (const flow of Object.values(manifest.flows ?? {})) {
        for (const name of flow.gates ?? []) add(`gate:${name}`, name, "gate");
      }
      break;
    case "vault":
      for (const name of Object.keys(manifest.vault ?? {}).sort()) {
        add(`vault:${name}`, name, "vault");
      }
      for (const flow of Object.values(manifest.flows ?? {})) {
        for (const name of flow.effects?.secrets ?? []) add(`vault:${name}`, name, "vault");
      }
      break;
    case "channel":
      for (const name of Object.keys(manifest.channels ?? {}).sort()) {
        add(`channel:${name}`, name, "channel");
      }
      for (const flow of Object.values(manifest.flows ?? {})) {
        for (const name of flow.effects?.sends ?? []) add(`channel:${name}`, name, "channel");
      }
      break;
    case "ai":
      for (const name of Object.keys(manifest.ai?.prompts ?? {}).sort()) {
        add(`ai:${name}`, name, "prompt");
      }
      for (const name of Object.keys(manifest.ai?.agents ?? {}).sort()) {
        add(`ai:${name}`, name, "agent");
      }
      for (const flow of Object.values(manifest.flows ?? {})) {
        for (const name of flow.effects?.asks ?? []) add(`ai:${name}`, name, "prompt");
      }
      break;
  }

  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function storeRefSpec(ref: string): ElementResource | null {
  if (ref.startsWith("sql:")) return { id: ref, label: ref.slice(4), badge: "sql" };
  if (ref.startsWith("kv:")) return { id: ref, label: ref.slice(3), badge: "kv" };
  if (ref.startsWith("files:")) return { id: ref, label: ref.slice(6), badge: "files" };
  if (ref.startsWith("index:")) return { id: ref, label: ref.slice(6), badge: "index" };
  return null;
}

/** One kind an element owns — Store facet, Gate kind, Channel medium, … */
export type ElementTypeKind = {
  readonly kind: string;
  readonly label: string;
};

/**
 * Fixed type vocabulary per element — the middle orbit, never named
 * catalogue rows (those fan on element focus).
 */
export const ELEMENT_TYPE_KINDS: Record<OkeElement, readonly ElementTypeKind[]> = {
  flow: FLOW_TRIGGER_KINDS.map((kind) => ({
    kind,
    label: FLOW_TRIGGER_KIND_SPECS[kind].label,
  })),
  signal: [
    { kind: "once", label: "once" },
    { kind: "broadcast", label: "broadcast" },
    { kind: "live", label: "live" },
  ],
  store: [
    { kind: "sql", label: "SQL" },
    { kind: "kv", label: "KV" },
    { kind: "files", label: "Files" },
    { kind: "index", label: "Index" },
  ],
  clock: [
    { kind: "cron", label: "cron" },
    { kind: "every", label: "every" },
  ],
  gate: [
    { kind: "policy", label: "policy" },
    { kind: "scope", label: "scope" },
    { kind: "rate", label: "rate" },
    { kind: "flag", label: "flag" },
  ],
  vault: [
    { kind: "secret", label: "secret" },
    { kind: "config", label: "config" },
    { kind: "env", label: "env" },
  ],
  channel: [
    { kind: "email", label: "email" },
    { kind: "sms", label: "SMS" },
    { kind: "whatsapp", label: "WA" },
    { kind: "push", label: "Push" },
  ],
  ai: [
    { kind: "model", label: "model" },
    { kind: "prompt", label: "prompt" },
    { kind: "embed", label: "embed" },
    { kind: "agent", label: "agent" },
  ],
};

/**
 * Types an element owns — the element's kind vocabulary, always.
 *
 * Named catalogue rows (KV namespaces, tables, prompts) stay off this
 * orbit and fan only when the element is focused. Store kinds are the
 * four facets (`sql` · `kv` · `files` · `index`) — cache lives on KV.
 *
 * @param _manifest - Live Manifest (kinds are fixed per element)
 * @param element - Element to list
 */
export function typesOfElement(
  _manifest: Manifest,
  element: OkeElement,
): readonly ElementResource[] {
  return ELEMENT_TYPE_KINDS[element].map((type) => ({
    id: `type:${element}:${type.kind}`,
    label: type.label,
    badge: type.kind,
  }));
}

function gateTypeKind(name: string, gate: Gate | undefined): string {
  if (gate?.kind === "rate" || name.startsWith("rate:")) return "rate";
  if (name.startsWith("flag:")) return "flag";
  if ((gate?.scopes?.length ?? 0) > 0) return "scope";
  return "policy";
}

function vaultTypeKind(contract: SecretContract | undefined): string {
  return contract?.sensitive === false ? "config" : "secret";
}

function aiTypeKind(manifest: Manifest, name: string): string {
  const bare = name.split("@")[0] ?? name;
  if (manifest.ai?.agents?.[bare]) return "agent";
  if (manifest.ai?.models?.[bare]) return "model";
  return "prompt";
}

/**
 * Type node ids a flow actually uses on one element.
 *
 * @param manifest - Live Manifest
 * @param flow - Manifest flow
 * @param element - Element the flow touches
 */
export function typeIdsUsedByFlow(
  manifest: Manifest,
  flow: Flow,
  element: OkeElement,
): readonly string[] {
  const prefix = `type:${element}:`;
  switch (element) {
    case "flow":
      return [`${prefix}${flowTriggerKind(flow.trigger)}`];
    case "store": {
      const facets = new Set<string>();
      for (const ref of [...(flow.effects?.reads ?? []), ...(flow.effects?.writes ?? [])]) {
        const spec = storeRefSpec(ref);
        if (spec?.badge) facets.add(spec.badge);
      }
      return [...facets].map((facet) => `${prefix}${facet}`);
    }
    case "signal": {
      const names = [
        ...(flow.trigger?.signal ? [flow.trigger.signal] : []),
        ...(flow.effects?.emits ?? []),
      ];
      const kinds = new Set<string>();
      for (const name of names) {
        const delivery = manifest.signals?.[name]?.delivery;
        if (delivery) kinds.add(delivery);
      }
      return [...kinds].map((kind) => `${prefix}${kind}`);
    }
    case "clock": {
      const kinds: string[] = [];
      if (flow.trigger?.cron) kinds.push(`${prefix}cron`);
      if (flow.trigger?.every) kinds.push(`${prefix}every`);
      return kinds;
    }
    case "gate":
      return [
        ...new Set((flow.gates ?? []).map((name) => gateTypeKind(name, manifest.gates?.[name]))),
      ].map((kind) => `${prefix}${kind}`);
    case "vault":
      return [
        ...new Set(
          (flow.effects?.secrets ?? []).map((name) => vaultTypeKind(manifest.vault?.[name])),
        ),
      ].map((kind) => `${prefix}${kind}`);
    case "channel": {
      const kinds = new Set<string>();
      for (const name of flow.effects?.sends ?? []) {
        const medium = manifest.channels?.[name]?.medium;
        if (medium && medium !== "any") kinds.add(medium);
      }
      return [...kinds].map((kind) => `${prefix}${kind}`);
    }
    case "ai":
      return [...new Set((flow.effects?.asks ?? []).map((name) => aiTypeKind(manifest, name)))].map(
        (kind) => `${prefix}${kind}`,
      );
  }
}

/**
 * Unit → element couplings from Manifest structure.
 *
 * @param manifest - Live Manifest
 */
export function couplingsOfManifest(manifest: Manifest | null | undefined): {
  readonly units: readonly UnitMapRow[];
  readonly hubs: readonly ElementHubRow[];
  readonly couplings: readonly ElementCoupling[];
} {
  const flows = manifest?.flows ?? {};
  const byUnit = new Map<string, string[]>();
  for (const flowId of Object.keys(flows).sort()) {
    const unit = unitOfFlowId(flowId);
    const list = byUnit.get(unit) ?? [];
    list.push(flowId);
    byUnit.set(unit, list);
  }

  const coupleCount = new Map<string, number>();
  const unitElements = new Map<string, Set<OkeElement>>();
  const elementFlows = new Map<OkeElement, Set<string>>();

  for (const [unit, ids] of byUnit) {
    const touched = new Set<OkeElement>();
    for (const flowId of ids) {
      const flow = flows[flowId];
      if (!flow) continue;
      for (const element of elementsOfFlow(flow)) {
        touched.add(element);
        const key = `${unit}\0${element}`;
        coupleCount.set(key, (coupleCount.get(key) ?? 0) + 1);
        const flowSet = elementFlows.get(element) ?? new Set();
        flowSet.add(flowId);
        elementFlows.set(element, flowSet);
      }
    }
    unitElements.set(unit, touched);
  }

  const units: UnitMapRow[] = [...byUnit.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([unit, ids]) => ({
      unit,
      flowCount: ids.length,
      elements: OKE_ELEMENTS.filter((element) => unitElements.get(unit)?.has(element)),
      live: 0,
      errors: 0,
    }));

  const hubs: ElementHubRow[] = OKE_ELEMENTS.map((element) => ({
    element,
    resourceCount: manifest ? resourcesOfElement(manifest, element).length : 0,
    flowCount: elementFlows.get(element)?.size ?? 0,
    live: 0,
    errors: 0,
  }));

  const couplings: ElementCoupling[] = [];
  for (const unit of units) {
    for (const element of unit.elements) {
      couplings.push({
        unit: unit.unit,
        element,
        flowCount: coupleCount.get(`${unit.unit}\0${element}`) ?? 0,
      });
    }
  }

  return { units, hubs, couplings };
}

/**
 * Paint live / error counts from the Traces ledger onto map rows.
 *
 * @param rows - Structural map rows
 * @param runs - Recent runs (already scoped to this app)
 */
export function applyLiveHeat(
  rows: {
    readonly units: readonly UnitMapRow[];
    readonly hubs: readonly ElementHubRow[];
    readonly couplings: readonly ElementCoupling[];
  },
  runs: readonly RunRow[],
): {
  readonly units: readonly UnitMapRow[];
  readonly hubs: readonly ElementHubRow[];
  readonly couplings: readonly ElementCoupling[];
} {
  const unitLive = new Map<string, number>();
  const unitErrors = new Map<string, number>();
  const hubLive = new Map<OkeElement, number>();
  const hubErrors = new Map<OkeElement, number>();

  for (const run of runs) {
    const unit = run.unit ?? unitOfFlowId(run.flow);
    unitLive.set(unit, (unitLive.get(unit) ?? 0) + 1);
    if (run.error) unitErrors.set(unit, (unitErrors.get(unit) ?? 0) + 1);
    for (const element of elementsOfRun(run)) {
      hubLive.set(element, (hubLive.get(element) ?? 0) + 1);
      if (run.error) hubErrors.set(element, (hubErrors.get(element) ?? 0) + 1);
    }
  }

  return {
    couplings: rows.couplings,
    units: rows.units.map((row) => ({
      ...row,
      live: unitLive.get(row.unit) ?? 0,
      errors: unitErrors.get(row.unit) ?? 0,
    })),
    hubs: rows.hubs.map((row) => ({
      ...row,
      live: hubLive.get(row.element) ?? 0,
      errors: hubErrors.get(row.element) ?? 0,
    })),
  };
}

/** Focus that stays on the bipartite map (overview or one element). */
export type MapFocus = { readonly kind: "element"; readonly element: OkeElement } | null;

/**
 * Build the overview (or element-isolated) React Flow graph.
 *
 * @param manifest - Live Manifest
 * @param runs - Recent runs for live heat
 * @param focus - `null` = eight hubs; element = that element's resources
 */
export function buildElementMap(
  manifest: Manifest | null | undefined,
  runs: readonly RunRow[] = [],
  focus: MapFocus = null,
): {
  readonly nodes: FlowGraphNode[];
  readonly edges: FlowGraphEdge[];
  readonly units: readonly UnitMapRow[];
  readonly hubs: readonly ElementHubRow[];
} {
  if (!manifest || Object.keys(manifest.flows ?? {}).length === 0) {
    return { nodes: [], edges: [], units: [], hubs: [] };
  }

  const heated = applyLiveHeat(couplingsOfManifest(manifest), runs);
  const isolate = focus?.element;
  const liveTotal = heated.hubs.find((row) => row.element === "flow")?.live ?? 0;
  const liveErrors = heated.hubs.find((row) => row.element === "flow")?.errors ?? 0;

  const nodes: FlowGraphNode[] = [];
  const edges: FlowGraphEdge[] = [];

  nodes.push(orbitNode("orbit:elements", HUB_LAYOUT.elementRing));
  nodes.push(orbitNode("orbit:types", HUB_LAYOUT.typeRing));
  nodes.push(orbitNode("orbit:spokes", HUB_LAYOUT.spokeRing));
  nodes.push({
    id: "law:oke",
    type: "law",
    position: {
      x: HUB_LAYOUT.cx - MAP_BOX.law.width / 2,
      y: HUB_LAYOUT.cy - MAP_BOX.law.height / 2,
    },
    data: {
      kind: "law",
      label: manifest.app,
      refId: "oke",
      badge: String(heated.units.reduce((n, row) => n + row.flowCount, 0)),
      live: liveTotal,
      errors: liveErrors,
    },
    selectable: false,
    draggable: false,
    zIndex: GRAPH_Z.leaf,
    width: MAP_BOX.law.width,
    height: MAP_BOX.law.height,
    style: {
      width: MAP_BOX.law.width,
      height: MAP_BOX.law.height,
      overflow: "visible",
    },
  });

  const hubAngles = ringAngles(OKE_ELEMENTS.length);
  heated.hubs.forEach((row, index) => {
    const angle = hubAngles[index] ?? 0;
    const box = MAP_BOX.hub;
    nodes.push({
      id: `element:${row.element}`,
      type: "element",
      position: radialPoint(angle, HUB_LAYOUT.elementRing, box),
      data: {
        kind: "element",
        label: ELEMENT_ICONS[row.element].symbol,
        refId: row.element,
        badge: String(row.resourceCount),
        live: row.live,
        errors: row.errors,
        dimmed: isolate != null && row.element !== isolate,
      },
      draggable: false,
      zIndex: GRAPH_Z.leaf,
      width: box.width,
      height: box.height,
      style: { width: box.width, height: box.height },
    });
    edges.push(coupleEdge(`element:${row.element}`, "law:oke", row.element, 1, true));
  });

  if (!isolate || isolate === "flow") {
    const typeBox = MAP_BOX.type;
    heated.hubs.forEach((row, index) => {
      const home = hubAngles[index] ?? 0;
      const types = typesOfElement(manifest, row.element);
      const slots = typeClusterSlots(home, types.length);
      types.forEach((resource, typeIndex) => {
        const slot = slots[typeIndex] ?? { angle: home, radius: HUB_LAYOUT.typeRing };
        nodes.push({
          id: resource.id,
          type: "typeChip",
          position: radialPoint(slot.angle, slot.radius, typeBox),
          data: {
            kind: row.element,
            label: resource.label,
            refId: resource.id,
            ...(resource.badge !== undefined
              ? { badge: resource.badge, facet: resource.badge }
              : {}),
          },
          draggable: false,
          zIndex: GRAPH_Z.leaf,
          width: typeBox.width,
          height: typeBox.height,
          style: { width: typeBox.width, height: typeBox.height },
        });
        edges.push(coupleEdge(resource.id, `element:${row.element}`, row.element, 1));
      });
    });
  }

  if (isolate && isolate !== "flow") {
    const resources = resourcesOfElement(manifest, isolate);
    const box = NODE_BOX.store;
    const angles = ringAngles(resources.length);
    resources.forEach((resource, index) => {
      const angle = angles[index] ?? 0;
      nodes.push({
        id: resource.id,
        type: isolate,
        position: radialPoint(angle, HUB_LAYOUT.spokeRing, box),
        data: {
          kind: isolate,
          label: resource.label,
          refId: resource.id,
          ...(resource.badge !== undefined ? { badge: resource.badge, facet: resource.badge } : {}),
        },
        draggable: false,
        zIndex: GRAPH_Z.leaf,
        width: box.width,
        height: box.height,
        style: { width: box.width, height: box.height },
      });
      edges.push(coupleEdge(resource.id, `element:${isolate}`, isolate, 1));
    });
  } else {
    const box = MAP_BOX.unit;
    const angles = ringAngles(heated.units.length);
    heated.units.forEach((row, index) => {
      const angle = angles[index] ?? 0;
      nodes.push({
        id: `unit:${row.unit}`,
        type: "unitChip",
        position: radialPoint(angle, HUB_LAYOUT.spokeRing, box),
        data: {
          kind: "unit",
          label: row.unit,
          refId: row.unit,
          badge: String(row.flowCount),
          elements: row.elements.filter((element) => element !== "flow"),
          live: row.live,
          errors: row.errors,
        },
        draggable: false,
        zIndex: GRAPH_Z.leaf,
        width: box.width,
        height: box.height,
        style: { width: box.width, height: box.height },
      });
    });

    const flowsByUnit = new Map<string, string[]>();
    for (const flowId of Object.keys(manifest.flows ?? {}).sort()) {
      const unit = unitOfFlowId(flowId);
      const list = flowsByUnit.get(unit) ?? [];
      list.push(flowId);
      flowsByUnit.set(unit, list);
    }

    for (const row of heated.units) {
      const typeCount = new Map<string, number>();
      const fallback = new Set<OkeElement>();
      for (const flowId of flowsByUnit.get(row.unit) ?? []) {
        const flow = manifest.flows?.[flowId];
        if (!flow) continue;
        for (const element of elementsOfFlow(flow)) {
          if (isolate === "flow" && element !== "flow") continue;
          const typeIds = typeIdsUsedByFlow(manifest, flow, element);
          if (typeIds.length === 0) fallback.add(element);
          for (const typeId of typeIds) {
            typeCount.set(typeId, (typeCount.get(typeId) ?? 0) + 1);
          }
        }
      }
      for (const [typeId, flowCount] of typeCount) {
        const element = typeId.slice("type:".length).split(":")[0];
        if (!element || !(element in NODE_ACCENT)) continue;
        edges.push(coupleEdge(`unit:${row.unit}`, typeId, element as OkeElement, flowCount));
      }
      for (const element of fallback) {
        edges.push(coupleEdge(`unit:${row.unit}`, `element:${element}`, element, 1));
      }
    }
  }

  return { nodes, edges, units: heated.units, hubs: heated.hubs };
}

function orbitNode(id: string, radius: number): FlowGraphNode {
  const size = radius * 2;
  return {
    id,
    type: "orbit",
    position: { x: HUB_LAYOUT.cx - radius, y: HUB_LAYOUT.cy - radius },
    data: { kind: "law", label: "", refId: id },
    selectable: false,
    draggable: false,
    zIndex: GRAPH_Z.edge,
    width: size,
    height: size,
    style: { width: size, height: size },
  };
}

function coupleRole(source: string, target: string): "trunk" | "bind" | "spoke" {
  if (target === "law:oke") return "trunk";
  if (source.startsWith("type:") && target.startsWith("element:")) return "bind";
  return "spoke";
}

function coupleIdleOpacity(role: "trunk" | "bind" | "spoke"): number {
  if (role === "trunk") return 0.14;
  if (role === "bind") return 0.2;
  return 0;
}

function coupleEdge(
  source: string,
  target: string,
  _element: OkeElement,
  flowCount: number,
  trunk = false,
): FlowGraphEdge {
  const role = trunk ? "trunk" : coupleRole(source, target);
  const width = role === "trunk" ? 1.15 : 1 + Math.min(1.25, Math.log2(1 + flowCount) * 0.45);
  return {
    id: `couple:${source}->${target}`,
    source,
    target,
    sourceHandle: "center",
    targetHandle: "center",
    type: "straight",
    data: { kind: "couple" },
    style: {
      stroke: EDGE_STROKE.couple,
      strokeWidth: width,
      opacity: coupleIdleOpacity(role),
    },
    zIndex: GRAPH_Z.edge,
  };
}

function elementOfNodeId(id: string): OkeElement | null {
  if (id.startsWith("element:")) {
    const element = id.slice("element:".length);
    return element in NODE_ACCENT ? (element as OkeElement) : null;
  }
  if (id.startsWith("type:")) {
    const element = id.slice("type:".length).split(":")[0];
    return element && element in NODE_ACCENT ? (element as OkeElement) : null;
  }
  return null;
}

function coupleAccent(source: string, target: string): string {
  for (const id of [target, source]) {
    const element = elementOfNodeId(id);
    if (element) return NODE_ACCENT[element].accent;
  }
  return EDGE_STROKE.couple;
}

/** Extra hover / chain emphasis for the overview map. */
export interface MapHighlightOptions {
  readonly hoverNodeId?: string | null;
  readonly highlightedFlowIds?: ReadonlySet<string>;
  readonly highlightedNodeIds?: ReadonlySet<string>;
  /** Manifest — required to light only the types a flow actually uses. */
  readonly manifest?: Manifest | null;
}

/**
 * Exact overview path for one or more flows: unit → used types →
 * elements → law. Not the unit's whole catalogue.
 *
 * @param manifest - Live Manifest
 * @param flowIds - Flows to paint
 */
export function mapPathForFlows(
  manifest: Manifest | null | undefined,
  flowIds: ReadonlySet<string>,
): { readonly nodeIds: ReadonlySet<string>; readonly edgeIds: ReadonlySet<string> } {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const couple = (source: string, target: string) => {
    edgeIds.add(`couple:${source}->${target}`);
  };
  if (!manifest) return { nodeIds, edgeIds };
  for (const flowId of flowIds) {
    const flow = manifest.flows?.[flowId];
    if (!flow) continue;
    const unit = `unit:${unitOfFlowId(flowId)}`;
    nodeIds.add(unit);
    for (const element of elementsOfFlow(flow)) {
      const elementId = `element:${element}`;
      nodeIds.add(elementId);
      nodeIds.add("law:oke");
      couple(elementId, "law:oke");
      const types = typeIdsUsedByFlow(manifest, flow, element);
      if (types.length === 0) couple(unit, elementId);
      for (const typeId of types) {
        nodeIds.add(typeId);
        couple(unit, typeId);
        couple(typeId, elementId);
      }
    }
  }
  return { nodeIds, edgeIds };
}

/**
 * Dim / emphasize overview nodes and bundled edges.
 *
 * Hover wins for edge emphasis. A selected / orchestra flow lights
 * only the types that flow uses — not every coupling on its unit.
 *
 * @param nodes - Map nodes
 * @param edges - Bundled couple edges
 * @param options - Hover + chain
 */
export function applyMapHighlight(
  nodes: readonly FlowGraphNode[],
  edges: readonly FlowGraphEdge[],
  options: MapHighlightOptions = {},
): { readonly nodes: FlowGraphNode[]; readonly edges: FlowGraphEdge[] } {
  const hover = options.hoverNodeId ?? null;
  const chainFlows = options.highlightedFlowIds ?? new Set();
  const chainNodes = options.highlightedNodeIds ?? new Set();
  const flowPath = mapPathForFlows(options.manifest, chainFlows);
  const chainActive = flowPath.nodeIds.size > 0 || chainNodes.size > 0;
  const hoverActive = hover != null;
  const hoverPath = hover != null ? hoverPathIds(hover, edges) : null;

  const nextNodes = nodes.map((node) => {
    if (node.type === "orbit") {
      return { ...node, data: { ...node.data, highlighted: false, dimmed: false } };
    }
    const inChain =
      flowPath.nodeIds.has(node.id) || chainNodes.has(node.id) || chainFlows.has(node.data.refId);
    const hovered = hoverPath?.has(node.id) === true;
    return {
      ...node,
      data: {
        ...node.data,
        highlighted: inChain || (hoverActive && node.id === hover),
        dimmed:
          node.id === "law:oke" ? false : (chainActive && !inChain) || (hoverActive && !hovered),
      },
    };
  });

  const nextEdges = edges.map((edge) => {
    const onHover = hoverPath != null && hoverPath.has(edge.source) && hoverPath.has(edge.target);
    const onChain = chainActive && flowPath.edgeIds.has(edge.id);
    const hot = hoverActive ? onHover : onChain;
    const role = coupleRole(edge.source, edge.target);
    const idle = !(hoverActive || chainActive);
    const opacity = idle ? coupleIdleOpacity(role) : hot ? 1 : coupleIdleOpacity(role) * 0.35;
    return {
      ...edge,
      animated: hot,
      style: {
        ...edge.style,
        stroke: hot ? coupleAccent(edge.source, edge.target) : EDGE_STROKE.couple,
        opacity,
        strokeWidth: hot ? 2.25 : edge.style?.strokeWidth,
      },
    } satisfies FlowGraphEdge;
  });

  return { nodes: nextNodes, edges: nextEdges };
}

function neighborsOf(edges: readonly Edge[], id: string): readonly string[] {
  const out: string[] = [];
  for (const edge of edges) {
    if (edge.source === id) out.push(edge.target);
    else if (edge.target === id) out.push(edge.source);
  }
  return out;
}

/**
 * Unit → types → elements → law (and the reverse from a type / element).
 *
 * @param hover - Hovered node id
 * @param edges - Couple edges
 */
function hoverPathIds(hover: string, edges: readonly Edge[]): ReadonlySet<string> {
  const ids = new Set<string>([hover]);
  const add = (id: string) => ids.add(id);
  if (hover.startsWith("unit:")) {
    for (const next of neighborsOf(edges, hover)) {
      add(next);
      if (next.startsWith("type:")) {
        for (const element of neighborsOf(edges, next)) {
          if (!element.startsWith("element:")) continue;
          add(element);
          for (const law of neighborsOf(edges, element)) {
            if (law === "law:oke") add(law);
          }
        }
      }
      if (next.startsWith("element:")) {
        for (const law of neighborsOf(edges, next)) {
          if (law === "law:oke") add(law);
        }
      }
    }
    return ids;
  }
  if (hover.startsWith("type:")) {
    for (const next of neighborsOf(edges, hover)) add(next);
    const element = [...ids].find((id) => id.startsWith("element:"));
    if (element) {
      for (const law of neighborsOf(edges, element)) {
        if (law === "law:oke") add(law);
      }
    }
    return ids;
  }
  if (hover.startsWith("element:") || hover === "law:oke") {
    for (const next of neighborsOf(edges, hover)) add(next);
  }
  return ids;
}
