/**
 * Overview map — units ↔ eight elements, live heat from runs.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../../../../../manifest/types.ts";
import type { RunRow } from "@/client.ts";
import { FLOWS_TEST_MANIFEST } from "../fixture.ts";
import {
  applyLiveHeat,
  applyMapHighlight,
  buildElementMap,
  mapPathForFlows,
  couplingsOfManifest,
  elementsOfFlow,
  elementsOfRun,
  fanAngles,
  radialPoint,
  resourcesOfElement,
  ringAngles,
  typeClusterSlots,
  typeIdsUsedByFlow,
  typesOfElement,
} from "./element-map.ts";
import { EDGE_STROKE, HUB_LAYOUT, MAP_BOX } from "./flow-graph-theme.ts";

function sampleRun(partial: Partial<RunRow> = {}): RunRow {
  return {
    id: "run-1",
    parentId: null,
    flow: "bookings.create",
    unit: "bookings",
    trigger: "http",
    plane: "user",
    tenant: null,
    principal: null,
    gates: [],
    cache: "none",
    replica: null,
    replicaLagMs: null,
    cost: null,
    promptVersion: null,
    buildVersion: null,
    startedAt: 1,
    endedAt: 13,
    durationMs: 12,
    error: null,
    errorMessage: null,
    sampled: "sample",
    effects: [],
    logs: [],
    dimensions: {},
    input: null,
    output: null,
    ...partial,
  };
}

describe("elementsOfFlow", () => {
  test("always includes flow and reads declared effects", () => {
    const create = FLOWS_TEST_MANIFEST.flows!["bookings.create"]!;
    expect(elementsOfFlow(create)).toEqual(["flow", "signal", "store"]);
    expect(elementsOfFlow(FLOWS_TEST_MANIFEST.flows!["fulfillment.onOrder"]!)).toEqual([
      "flow",
      "signal",
      "store",
      "channel",
    ]);
    expect(elementsOfFlow(FLOWS_TEST_MANIFEST.flows!["payments.chargeBooking"]!)).toEqual([
      "flow",
      "vault",
    ]);
  });
});

describe("elementsOfRun", () => {
  test("maps ledger effects onto elements", () => {
    expect(
      elementsOfRun(
        sampleRun({
          trigger: "cron",
          gates: ["member"],
          effects: [
            {
              kind: "write",
              resource: "sql:bookings",
              timestamp: 1,
              duration: 2,
              reversibility: "reversible",
            },
            {
              kind: "secret",
              resource: "STRIPE_KEY",
              timestamp: 2,
              duration: 1,
              reversibility: "capability",
            },
          ],
        }),
      ),
    ).toEqual(["flow", "store", "clock", "gate", "vault"]);
  });
});

describe("couplingsOfManifest", () => {
  const { units, hubs, couplings } = couplingsOfManifest(FLOWS_TEST_MANIFEST);

  test("one unit row per dotted prefix", () => {
    expect(units.map((u) => u.unit)).toEqual(["bookings", "fulfillment", "payments"]);
    expect(units.find((u) => u.unit === "bookings")?.flowCount).toBe(2);
  });

  test("always emits eight element hubs", () => {
    expect(hubs.map((h) => h.element)).toEqual([
      "flow",
      "signal",
      "store",
      "clock",
      "gate",
      "vault",
      "channel",
      "ai",
    ]);
    expect(hubs.find((h) => h.element === "flow")?.flowCount).toBe(4);
    expect(hubs.find((h) => h.element === "store")?.resourceCount).toBe(2);
    expect(hubs.find((h) => h.element === "vault")?.resourceCount).toBe(1);
  });

  test("every unit couples to flow plus the elements it declares", () => {
    expect(couplings.some((c) => c.unit === "bookings" && c.element === "flow")).toBe(true);
    expect(couplings.some((c) => c.unit === "bookings" && c.element === "store")).toBe(true);
    expect(couplings.some((c) => c.unit === "payments" && c.element === "vault")).toBe(true);
  });
});

describe("typesOfElement", () => {
  test("lists each element's kind vocabulary — never named instances", () => {
    expect(typesOfElement(FLOWS_TEST_MANIFEST, "flow").map((t) => t.id)).toEqual([
      "type:flow:http",
      "type:flow:signal",
      "type:flow:cron",
      "type:flow:every",
      "type:flow:cdc",
      "type:flow:internal",
    ]);
    expect(typesOfElement(FLOWS_TEST_MANIFEST, "store").map((t) => t.label)).toEqual([
      "SQL",
      "KV",
      "Files",
      "Index",
    ]);
    const keelLike: Manifest = {
      ...FLOWS_TEST_MANIFEST,
      stores: {
        ...FLOWS_TEST_MANIFEST.stores,
        drafts: { facet: "kv", namespaces: ["drafts"] },
        "triage-snooze": { facet: "kv", namespaces: ["triage-snooze"] },
      },
    };
    expect(typesOfElement(keelLike, "store").map((t) => t.id)).toEqual([
      "type:store:sql",
      "type:store:kv",
      "type:store:files",
      "type:store:index",
    ]);
    expect(typesOfElement(FLOWS_TEST_MANIFEST, "gate").map((t) => t.label)).toEqual([
      "policy",
      "scope",
      "rate",
      "flag",
    ]);
    expect(typesOfElement(FLOWS_TEST_MANIFEST, "channel").map((t) => t.label)).toEqual([
      "email",
      "SMS",
      "WA",
      "Push",
    ]);
    expect(typesOfElement(FLOWS_TEST_MANIFEST, "signal").map((t) => t.id)).toEqual([
      "type:signal:once",
      "type:signal:broadcast",
      "type:signal:live",
    ]);
    expect(typesOfElement(FLOWS_TEST_MANIFEST, "vault").map((t) => t.id)).toEqual([
      "type:vault:secret",
      "type:vault:config",
      "type:vault:env",
    ]);
    expect(typesOfElement(FLOWS_TEST_MANIFEST, "clock").map((t) => t.id)).toEqual([
      "type:clock:cron",
      "type:clock:every",
    ]);
    expect(typesOfElement(FLOWS_TEST_MANIFEST, "ai").map((t) => t.id)).toEqual([
      "type:ai:model",
      "type:ai:prompt",
      "type:ai:embed",
      "type:ai:agent",
    ]);
  });
});

describe("typeIdsUsedByFlow", () => {
  test("maps a flow onto the kinds it actually uses", () => {
    const create = FLOWS_TEST_MANIFEST.flows!["bookings.create"]!;
    expect(typeIdsUsedByFlow(FLOWS_TEST_MANIFEST, create, "flow")).toEqual(["type:flow:http"]);
    expect(typeIdsUsedByFlow(FLOWS_TEST_MANIFEST, create, "store")).toEqual(["type:store:sql"]);
    expect(typeIdsUsedByFlow(FLOWS_TEST_MANIFEST, create, "signal")).toEqual(["type:signal:once"]);
    const pay = FLOWS_TEST_MANIFEST.flows!["payments.chargeBooking"]!;
    expect(typeIdsUsedByFlow(FLOWS_TEST_MANIFEST, pay, "vault")).toEqual(["type:vault:secret"]);
    const fulfill = FLOWS_TEST_MANIFEST.flows!["fulfillment.onOrder"]!;
    expect(typeIdsUsedByFlow(FLOWS_TEST_MANIFEST, fulfill, "channel")).toEqual([
      "type:channel:email",
    ]);
  });
});

describe("resourcesOfElement", () => {
  test("lists catalogue + declared refs", () => {
    const stores = resourcesOfElement(FLOWS_TEST_MANIFEST, "store");
    expect(stores.map((r) => r.id).sort()).toEqual(["sql:bookings", "sql:shipments"]);
    expect(resourcesOfElement(FLOWS_TEST_MANIFEST, "channel").map((r) => r.id)).toEqual([
      "channel:booking-confirmed",
    ]);
  });

  test("a kv namespace named cache is a KV resource, not a store type", () => {
    const withCacheKv: Manifest = {
      ...FLOWS_TEST_MANIFEST,
      stores: {
        ...FLOWS_TEST_MANIFEST.stores,
        cache: { facet: "kv", namespaces: ["cache"] },
      },
    };
    expect(typesOfElement(withCacheKv, "store").map((t) => t.id)).toEqual([
      "type:store:sql",
      "type:store:kv",
      "type:store:files",
      "type:store:index",
    ]);
    expect(resourcesOfElement(withCacheKv, "store").map((r) => r.id).sort()).toEqual([
      "kv:cache",
      "sql:bookings",
      "sql:shipments",
    ]);
  });
});

describe("applyLiveHeat", () => {
  test("counts runs onto units and hubs", () => {
    const structural = couplingsOfManifest(FLOWS_TEST_MANIFEST);
    const heated = applyLiveHeat(structural, [
      sampleRun({ id: "a", error: "Boom" }),
      sampleRun({
        id: "b",
        flow: "fulfillment.onOrder",
        unit: "fulfillment",
        trigger: "signal",
        effects: [
          {
            kind: "send",
            resource: "booking-confirmed",
            timestamp: 1,
            duration: 2,
            reversibility: "irreversible",
          },
        ],
      }),
    ]);
    expect(heated.units.find((u) => u.unit === "bookings")).toMatchObject({ live: 1, errors: 1 });
    expect(heated.hubs.find((h) => h.element === "channel")?.live).toBe(1);
    expect(heated.hubs.find((h) => h.element === "flow")?.live).toBe(2);
  });
});

describe("buildElementMap", () => {
  test("overview is a radial hub — law, eight discs, units on the outer ring", () => {
    const { nodes, edges } = buildElementMap(FLOWS_TEST_MANIFEST);
    expect(nodes.some((n) => n.id === "law:oke")).toBe(true);
    expect(nodes.filter((n) => n.type === "element")).toHaveLength(8);
    expect(nodes.filter((n) => n.type === "element").map((n) => n.data.label)).toEqual([
      "Fl",
      "Sg",
      "St",
      "Ck",
      "Gt",
      "Vt",
      "Ch",
      "Ai",
    ]);
    expect(nodes.filter((n) => n.data.kind === "unit").map((n) => n.id)).toEqual([
      "unit:bookings",
      "unit:fulfillment",
      "unit:payments",
    ]);
    expect(nodes.some((n) => n.id.startsWith("flow:"))).toBe(false);
    const unitXs = new Set(
      nodes.filter((n) => n.data.kind === "unit").map((n) => Math.round(n.position.x)),
    );
    expect(unitXs.size).toBeGreaterThan(1);
    expect(edges.every((e) => e.data?.kind === "couple")).toBe(true);
    expect(edges.every((e) => e.type === "straight")).toBe(true);
    expect(edges.some((e) => e.id === "couple:unit:bookings->type:store:sql")).toBe(true);
    expect(edges.some((e) => e.id === "couple:unit:bookings->element:store")).toBe(false);
    expect(edges.some((e) => e.id === "couple:element:store->law:oke")).toBe(true);
    expect(nodes.some((n) => n.type === "typeChip" && n.id === "type:store:sql")).toBe(true);
    expect(nodes.some((n) => n.type === "typeChip" && n.id === "type:store:kv")).toBe(true);
    expect(nodes.some((n) => n.id === "type:store:cache")).toBe(false);
    expect(nodes.some((n) => n.type === "typeChip" && n.id === "type:gate:policy")).toBe(true);
    expect(nodes.some((n) => n.type === "typeChip" && n.id === "type:channel:whatsapp")).toBe(true);
    expect(edges.some((e) => e.id === "couple:type:store:sql->element:store")).toBe(true);
    expect(edges.every((e) => e.style?.stroke === EDGE_STROKE.couple)).toBe(true);
    expect(edges.find((e) => e.id === "couple:unit:bookings->type:store:sql")?.style?.opacity).toBe(
      0,
    );
    expect(
      Number(edges.find((e) => e.id === "couple:type:store:sql->element:store")?.style?.opacity),
    ).toBeGreaterThan(0);
    const store = nodes.find((n) => n.id === "element:store")!;
    const storeCx = store.position.x + MAP_BOX.hub.width / 2;
    const storeCy = store.position.y + MAP_BOX.hub.height / 2;
    const home = Math.atan2(storeCy - HUB_LAYOUT.cy, storeCx - HUB_LAYOUT.cx);
    for (const chip of nodes.filter((n) => n.id.startsWith("type:store:"))) {
      const cx = chip.position.x + MAP_BOX.type.width / 2;
      const cy = chip.position.y + MAP_BOX.type.height / 2;
      const radius = Math.hypot(cx - HUB_LAYOUT.cx, cy - HUB_LAYOUT.cy);
      expect(radius).toBeGreaterThan(HUB_LAYOUT.elementRing);
      expect(radius).toBeLessThan(HUB_LAYOUT.spokeRing - 200);
      expect(Math.abs(Math.atan2(cy - HUB_LAYOUT.cy, cx - HUB_LAYOUT.cx) - home)).toBeLessThan(
        Math.PI / 8,
      );
    }
  });

  test("element focus keeps the eight discs and fans that element's resources", () => {
    const { nodes, edges } = buildElementMap(FLOWS_TEST_MANIFEST, [], {
      kind: "element",
      element: "store",
    });
    expect(nodes.filter((n) => n.type === "element")).toHaveLength(8);
    expect(nodes.some((n) => n.data.kind === "unit")).toBe(false);
    expect(
      nodes
        .filter((n) => n.data.kind === "store")
        .map((n) => n.id)
        .sort(),
    ).toEqual(["sql:bookings", "sql:shipments"]);
    expect(edges.some((e) => e.source === "sql:bookings" && e.target === "element:store")).toBe(
      true,
    );
  });

  test("empty / null Manifest yields an empty map", () => {
    expect(buildElementMap(null).nodes).toEqual([]);
    expect(buildElementMap({ oke: "1.0", app: "x" } as Manifest).edges).toEqual([]);
  });
});

describe("ringAngles / radialPoint", () => {
  test("eight elements start at 12 o'clock", () => {
    const angles = ringAngles(8);
    expect(angles).toHaveLength(8);
    expect(angles[0]).toBeCloseTo(-Math.PI / 2);
    const top = radialPoint(angles[0]!, HUB_LAYOUT.elementRing, MAP_BOX.hub);
    expect(top.x).toBeCloseTo(HUB_LAYOUT.cx - MAP_BOX.hub.width / 2);
    expect(top.y).toBeLessThan(HUB_LAYOUT.cy);
  });

  test("fanAngles stay inside the home sector", () => {
    const home = -Math.PI / 2;
    const fan = fanAngles(home, 3);
    expect(fan).toHaveLength(3);
    expect(fan[1]).toBeCloseTo(home);
    expect(fan[0]!).toBeLessThan(home);
    expect(fan[2]!).toBeGreaterThan(home);
  });

  test("element hubs are a tight disc — one label, not a two-line card", () => {
    expect(MAP_BOX.hub).toEqual({ width: 56, height: 56 });
    expect(MAP_BOX.hub.width).toBeLessThan(MAP_BOX.law.width);
    expect(MAP_BOX.hub.height).toBeGreaterThan(MAP_BOX.type.height);
  });

  test("typeClusterSlots pack 4+ kinds on two rows around the heading", () => {
    const home = 0;
    const four = typeClusterSlots(home, 4);
    expect(four).toHaveLength(4);
    expect(new Set(four.map((s) => s.radius)).size).toBe(2);
    expect(four[2]!.radius - four[0]!.radius).toBeGreaterThan(MAP_BOX.type.width);
    expect(four.every((s) => Math.abs(s.angle - home) < Math.PI / 8)).toBe(true);
    const six = typeClusterSlots(home, 6);
    expect(six).toHaveLength(6);
    expect(six.filter((s) => s.radius === HUB_LAYOUT.typeRing)).toHaveLength(3);
    expect(six.filter((s) => s.radius === HUB_LAYOUT.typeRing + HUB_LAYOUT.typeRow)).toHaveLength(
      3,
    );
    const south = typeClusterSlots(Math.PI / 2, 4);
    const a = south[0]!;
    const b = south[1]!;
    const chord = 2 * a.radius * Math.sin(Math.abs(b.angle - a.angle) / 2);
    expect(chord).toBeGreaterThan(MAP_BOX.type.width);
  });
});

describe("applyMapHighlight", () => {
  test("hover lights only the touched couple edges", () => {
    const { nodes, edges } = buildElementMap(FLOWS_TEST_MANIFEST);
    const next = applyMapHighlight(nodes, edges, { hoverNodeId: "unit:payments" });
    const vault = next.edges.find((e) => e.id === "couple:unit:payments->type:vault:secret");
    const store = next.edges.find((e) => e.id === "couple:unit:bookings->type:store:sql");
    expect(vault?.style?.opacity).toBe(1);
    expect(vault?.style?.stroke).not.toBe(EDGE_STROKE.couple);
    expect(store?.style?.opacity).toBe(0);
    expect(store?.style?.stroke).toBe(EDGE_STROKE.couple);
  });

  test("a flow lights only the types it uses — not the unit's whole catalogue", () => {
    const { nodes, edges } = buildElementMap(FLOWS_TEST_MANIFEST);
    const path = mapPathForFlows(FLOWS_TEST_MANIFEST, new Set(["bookings.mine"]));
    expect([...path.nodeIds].sort()).toEqual([
      "element:flow",
      "element:store",
      "law:oke",
      "type:flow:http",
      "type:store:sql",
      "unit:bookings",
    ]);
    expect(path.edgeIds.has("couple:unit:bookings->type:store:sql")).toBe(true);
    expect(path.edgeIds.has("couple:unit:bookings->type:signal:once")).toBe(false);
    const next = applyMapHighlight(nodes, edges, {
      highlightedFlowIds: new Set(["bookings.mine"]),
      manifest: FLOWS_TEST_MANIFEST,
    });
    const sql = next.edges.find((e) => e.id === "couple:unit:bookings->type:store:sql");
    const signal = next.edges.find((e) => e.id === "couple:unit:bookings->type:signal:once");
    const channel = next.nodes.find((n) => n.id === "type:channel:email");
    expect(sql?.style?.opacity).toBe(1);
    expect(signal?.style?.opacity ?? 0).toBe(0);
    expect(channel?.data.dimmed).toBe(true);
    expect(next.nodes.find((n) => n.id === "type:store:sql")?.data.highlighted).toBe(true);
    expect(next.nodes.find((n) => n.id === "type:signal:once")?.data.highlighted).toBeFalsy();
  });
});
