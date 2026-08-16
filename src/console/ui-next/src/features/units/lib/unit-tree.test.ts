/**
 * Unit tests for Units tree text search + advanced facet filtering.
 */

import { describe, expect, test } from "bun:test";
import type { Flow, Manifest, SignalDelivery } from "../../../../../../manifest/types.ts";
import {
  bandUnitTree,
  buildUnitTree,
  countActiveFacets,
  filterUnitTree,
  filterUnitsAdvanced,
  unitTreeAncestorKeys,
  unitTreeBandKey,
  unitTreeGroupKey,
  unitTreeIsOpen,
  unitTreeOpenKeys,
  type UnitFlowRow,
  type UnitGroup,
} from "./unit-tree.ts";

/**
 * Build a tree row from a dotted flow id + Manifest flow.
 *
 * @param id - Dotted flow id (`unit.action`)
 * @param flow - Manifest flow
 */
function row(id: string, flow: Flow, delivery: SignalDelivery | null = null): UnitFlowRow {
  const unit = id.includes(".") ? id.slice(0, id.indexOf(".")) : id;
  const action = id.includes(".") ? id.slice(id.indexOf(".") + 1) : id;
  return {
    id,
    unit,
    action,
    flow,
    method: flow.trigger?.http?.method ?? null,
    path: flow.trigger?.http?.path ?? null,
    signal: flow.trigger?.signal ?? null,
    delivery,
  };
}

/**
 * Build a unit group.
 *
 * @param unit - Unit name
 * @param flows - Rows in the group
 */
function group(unit: string, flows: readonly UnitFlowRow[]): UnitGroup {
  return { unit, flows };
}

const TREE: readonly UnitGroup[] = [
  group("billing", [
    row("billing.charge", {
      trigger: { http: { method: "POST", path: "/billing/charge" } },
      plane: "user",
    }),
    row("billing.reconcile", {
      trigger: { cron: "0 * * * *" },
      plane: "operator",
      durable: true,
    }),
  ]),
  group("orders", [
    row("orders.onPlaced", { trigger: { signal: "order-placed" }, live: true }, "once"),
    row("orders.sync", { trigger: { cdc: { table: "orders" } }, plane: "operator" }),
    row("orders.helper", {}),
  ]),
];

/** Flattened flow ids of a filtered tree. */
function flowIds(groups: readonly UnitGroup[]): string[] {
  return groups.flatMap((g) => g.flows.map((f) => f.id));
}

describe("filterUnitsAdvanced", () => {
  test("empty facets return the input tree unchanged", () => {
    expect(filterUnitsAdvanced(TREE, {})).toBe(TREE);
    expect(filterUnitsAdvanced(TREE, { triggerKinds: [], planes: [] })).toBe(TREE);
  });

  test("filters by a single trigger kind and drops empty groups", () => {
    const out = filterUnitsAdvanced(TREE, { triggerKinds: ["signal"] });
    expect(out.map((g) => g.unit)).toEqual(["orders"]);
    expect(flowIds(out)).toEqual(["orders.onPlaced"]);
  });

  test("filters by multiple trigger kinds (OR within the facet)", () => {
    const out = filterUnitsAdvanced(TREE, { triggerKinds: ["cron", "cdc"] });
    expect(flowIds(out)).toEqual(["billing.reconcile", "orders.sync"]);
  });

  test("call-only facet keeps triggerless flows", () => {
    const out = filterUnitsAdvanced(TREE, { triggerKinds: ["internal"] });
    expect(flowIds(out)).toEqual(["orders.helper"]);
  });

  test("filters by plane, treating a missing plane as user", () => {
    const operators = filterUnitsAdvanced(TREE, { planes: ["operator"] });
    expect(flowIds(operators)).toEqual(["billing.reconcile", "orders.sync"]);
    const users = filterUnitsAdvanced(TREE, { planes: ["user"] });
    expect(flowIds(users)).toEqual(["billing.charge", "orders.onPlaced", "orders.helper"]);
  });

  test("durable / live flags keep only flagged flows", () => {
    expect(flowIds(filterUnitsAdvanced(TREE, { durableOnly: true }))).toEqual([
      "billing.reconcile",
    ]);
    expect(flowIds(filterUnitsAdvanced(TREE, { liveOnly: true }))).toEqual(["orders.onPlaced"]);
  });

  test("facet dimensions AND together", () => {
    const out = filterUnitsAdvanced(TREE, {
      triggerKinds: ["signal"],
      planes: ["operator"],
    });
    expect(out).toEqual([]);
    const cronOps = filterUnitsAdvanced(TREE, {
      triggerKinds: ["cron", "signal"],
      planes: ["operator"],
      durableOnly: true,
    });
    expect(flowIds(cronOps)).toEqual(["billing.reconcile"]);
  });

  test("intersects with free-text search results", () => {
    const textHit = filterUnitTree(TREE, "orders");
    expect(flowIds(filterUnitsAdvanced(textHit, { triggerKinds: ["signal"] }))).toEqual([
      "orders.onPlaced",
    ]);
    const pathHit = filterUnitTree(TREE, "/billing/charge");
    expect(flowIds(filterUnitsAdvanced(pathHit, { planes: ["user"] }))).toEqual(["billing.charge"]);
    expect(flowIds(filterUnitsAdvanced(pathHit, { planes: ["operator"] }))).toEqual([]);
  });

  test("filters by signal delivery physics and drops rows without a join", () => {
    expect(flowIds(filterUnitsAdvanced(TREE, { deliveries: ["once"] }))).toEqual([
      "orders.onPlaced",
    ]);
    expect(filterUnitsAdvanced(TREE, { deliveries: ["broadcast"] })).toEqual([]);
  });
});

describe("filterUnitTree", () => {
  test("matches signal name and delivery physics", () => {
    expect(flowIds(filterUnitTree(TREE, "order-placed"))).toEqual(["orders.onPlaced"]);
    expect(flowIds(filterUnitTree(TREE, "once"))).toEqual(["orders.onPlaced"]);
    expect(flowIds(filterUnitTree(TREE, "broadcast"))).toEqual([]);
  });
});

describe("buildUnitTree", () => {
  test("joins trigger.signal onto manifest.signals.delivery", () => {
    const manifest = {
      oke: "1.0",
      app: "test",
      flows: {
        "notify.onTask": { trigger: { signal: "task-changed" } },
        "notify.onComment": { trigger: { signal: "comment-added" } },
        "billing.charge": { trigger: { http: { method: "POST", path: "/charge" } } },
      },
      signals: {
        "task-changed": { delivery: "broadcast" },
        "comment-added": { delivery: "once" },
      },
    } as Manifest;
    const groups = buildUnitTree(manifest);
    const notify = groups.find((g) => g.unit === "notify");
    expect(notify?.flows.map((f) => [f.action, f.signal, f.delivery])).toEqual([
      ["onComment", "comment-added", "once"],
      ["onTask", "task-changed", "broadcast"],
    ]);
    const billing = groups.find((g) => g.unit === "billing");
    expect(billing?.flows[0]).toMatchObject({ signal: null, delivery: null, method: "POST" });
  });

  test("sorts HTTP flows GET, POST, QUERY, PATCH/PUT, DELETE, then by id", () => {
    const manifest = {
      oke: "1.0",
      app: "test",
      flows: {
        "tasks.addTag": { trigger: { http: { method: "POST", path: "/tasks/:id/tags" } } },
        "tasks.archive": { trigger: { http: { method: "POST", path: "/tasks/:id/archive" } } },
        "tasks.delete": { trigger: { http: { method: "DELETE", path: "/tasks/:id" } } },
        "tasks.get": { trigger: { http: { method: "GET", path: "/tasks/:id" } } },
        "tasks.list": { trigger: { http: { method: "GET", path: "/tasks" } } },
        "tasks.search": { trigger: { http: { method: "QUERY", path: "/tasks/search" } } },
        "tasks.update": { trigger: { http: { method: "PATCH", path: "/tasks/:id" } } },
        "tasks.replace": { trigger: { http: { method: "PUT", path: "/tasks/:id" } } },
      },
    } as Manifest;
    const tasks = buildUnitTree(manifest).find((g) => g.unit === "tasks");
    expect(tasks?.flows.map((f) => `${f.action} ${f.method}`)).toEqual([
      "get GET",
      "list GET",
      "addTag POST",
      "archive POST",
      "search QUERY",
      "replace PUT",
      "update PATCH",
      "delete DELETE",
    ]);
  });
});

describe("countActiveFacets", () => {
  test("counts each individual selection", () => {
    expect(countActiveFacets({})).toBe(0);
    expect(countActiveFacets({ triggerKinds: ["http", "cron"] })).toBe(2);
    expect(countActiveFacets({ planes: ["user"], durableOnly: true, liveOnly: true })).toBe(3);
    expect(countActiveFacets({ deliveries: ["once", "live"] })).toBe(2);
    expect(countActiveFacets({ triggerKinds: [], durableOnly: false })).toBe(0);
  });
});

describe("bandUnitTree", () => {
  test("returns only populated trigger kind bands", () => {
    const bands = bandUnitTree(TREE);
    expect(bands.map((b) => b.id)).toEqual(["http", "signal", "cron", "cdc", "internal"]);
    expect(bands[0]!.groups.map((g) => g.unit)).toEqual(["billing"]);
    expect(bands[0]!.groups[0]!.flows.map((f) => f.id)).toEqual(["billing.charge"]);
    expect(bands[1]!.groups.map((g) => g.unit)).toEqual(["orders"]);
    expect(bands[1]!.groups[0]!.flows.map((f) => f.id)).toEqual(["orders.onPlaced"]);
    expect(bands[2]!.groups.map((g) => g.unit)).toEqual(["billing"]);
    expect(bands[2]!.groups[0]!.flows.map((f) => f.id)).toEqual(["billing.reconcile"]);
    expect(bands[3]!.groups.map((g) => g.unit)).toEqual(["orders"]);
    expect(bands[3]!.groups[0]!.flows.map((f) => f.id)).toEqual(["orders.sync"]);
    expect(bands[4]!.groups.map((g) => g.unit)).toEqual(["orders"]);
    expect(bands[4]!.groups[0]!.flows.map((f) => f.id)).toEqual(["orders.helper"]);
  });

  test("hides empty bands when the tree is HTTP-only", () => {
    const httpOnly = bandUnitTree([
      group("bookings", [
        row("bookings.create", {
          trigger: { http: { method: "POST", path: "/bookings" } },
        }),
      ]),
      group("support", [
        row("support.triage", {
          trigger: { http: { method: "POST", path: "/support/triage" } },
        }),
      ]),
    ]);
    expect(httpOnly.map((b) => b.id)).toEqual(["http"]);
    expect(httpOnly[0]!.groups.map((g) => g.unit)).toEqual(["bookings", "support"]);
  });

  test("open keys cover each band and unit folder", () => {
    const bands = bandUnitTree(TREE);
    expect(unitTreeBandKey("http")).toBe("band:http");
    expect(unitTreeGroupKey("http", "billing")).toBe("unit:http:billing");
    expect(unitTreeOpenKeys(bands)).toEqual([
      "band:http",
      "unit:http:billing",
      "band:signal",
      "unit:signal:orders",
      "band:cron",
      "unit:cron:billing",
      "band:cdc",
      "unit:cdc:orders",
      "band:internal",
      "unit:internal:orders",
    ]);
  });

  test("ancestor keys open the band and unit folder for a flow", () => {
    const bands = bandUnitTree(TREE);
    expect(unitTreeAncestorKeys(bands, "billing.charge")).toEqual([
      "band:http",
      "unit:http:billing",
    ]);
    expect(unitTreeAncestorKeys(bands, "orders.helper")).toEqual([
      "band:internal",
      "unit:internal:orders",
    ]);
    expect(unitTreeAncestorKeys(bands, "missing")).toEqual([]);
  });

  test("bands and unit folders default closed unless searching", () => {
    expect(unitTreeIsOpen("band:http", {})).toBe(false);
    expect(unitTreeIsOpen("unit:http:billing", {})).toBe(false);
    expect(unitTreeIsOpen("band:http", {}, true)).toBe(true);
    expect(unitTreeIsOpen("band:http", { "band:http": false })).toBe(false);
    expect(unitTreeIsOpen("band:http", { "band:http": false }, true)).toBe(false);
    expect(unitTreeIsOpen("unit:http:billing", { "unit:http:billing": true })).toBe(true);
  });
});
