/**
 * Unit tests for effect summary chips and request metadata helpers.
 */

import { effectSummaryChips, effectEventLabel } from "./effect-summary.ts";
import { effectBarColor, effectKindIcon, effectKindSummaryLabel } from "./effect-kind.ts";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { EDGE_STROKE } from "../graph/flow-graph-theme.ts";
import { httpMethodBadgeClass, httpMethodRailClass } from "./http-method.ts";
import { executeTraceReplay, replayRequestForRun } from "./trace-actions.ts";
import { FLOWS_TEST_MANIFEST } from "../../../../../ui/flows/fixture.ts";
import { traceRequestMeta } from "./request-meta.ts";
import { traceGateInfos } from "./trace-gates.ts";
import type { RunRow } from "@/client.ts";
import { describe, expect, test } from "bun:test";

function sampleRun(partial: Partial<RunRow> = {}): RunRow {
  return {
    id: "run-42",
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
    startedAt: 1_000,
    endedAt: 1_056,
    durationMs: 56,
    error: null,
    errorMessage: null,
    sampled: "sample",
    effects: [
      {
        kind: "read",
        resource: "sql:bookings",
        timestamp: 1_003,
        duration: 9,
        reversibility: "none",
      },
      {
        kind: "write",
        resource: "sql:bookings",
        timestamp: 1_014,
        duration: 18,
        reversibility: "reversible",
      },
      {
        kind: "emit",
        resource: "order-placed",
        timestamp: 1_036,
        duration: 5,
        reversibility: "deferred",
      },
    ],
    logs: [
      { level: "info", message: "creating", at: 1_001 },
      { level: "info", message: "done", at: 1_050 },
    ],
    dimensions: {},
    input: { flightId: "SK-441", seats: 2 },
    output: { id: "bk_8f2a" },
    ...partial,
  };
}

describe("effectKindSummaryLabel", () => {
  test("pluralizes real EffectKind values", () => {
    expect(effectKindSummaryLabel("read", 1)).toBe("1 read");
    expect(effectKindSummaryLabel("read", 2)).toBe("2 reads");
    expect(effectKindSummaryLabel("call", 1)).toBe("1 call");
  });
});

describe("effectBarColor", () => {
  test("reuses Flow graph EDGE_STROKE for edge-aligned kinds", () => {
    expect(effectBarColor("read")).toBe(EDGE_STROKE.reads);
    expect(effectBarColor("write")).toBe(EDGE_STROKE.writes);
    expect(effectBarColor("emit")).toBe(EDGE_STROKE.emits);
    expect(effectBarColor("call")).toBe(EDGE_STROKE.calls);
    expect(effectBarColor("ask")).toBe(EDGE_STROKE.asks);
  });
});

describe("effectKindIcon", () => {
  test("reuses Flow graph element icons per effect kind", () => {
    expect(effectKindIcon("read")).toBe(ELEMENT_ICONS.store.icon);
    expect(effectKindIcon("write")).toBe(ELEMENT_ICONS.store.icon);
    expect(effectKindIcon("emit")).toBe(ELEMENT_ICONS.signal.icon);
    expect(effectKindIcon("call")).toBe(ELEMENT_ICONS.flow.icon);
    expect(effectKindIcon("ask")).toBe(ELEMENT_ICONS.ai.icon);
    expect(effectKindIcon("send")).toBe(ELEMENT_ICONS.channel.icon);
    expect(effectKindIcon("secret")).toBe(ELEMENT_ICONS.vault.icon);
  });
});

describe("httpMethodBadgeClass", () => {
  test("assigns distinct accents per method", () => {
    expect(httpMethodBadgeClass("GET")).toContain("emerald");
    expect(httpMethodBadgeClass("POST")).toContain("sky");
    expect(httpMethodBadgeClass("PUT")).toContain("amber");
    expect(httpMethodBadgeClass("DELETE")).toContain("rose");
  });
});

describe("httpMethodRailClass", () => {
  test("matches solid fills to badge accents", () => {
    expect(httpMethodRailClass("POST")).toContain("sky");
    expect(httpMethodRailClass("GET")).toContain("emerald");
  });
});

describe("effectSummaryChips", () => {
  test("derives chips from real effects, HTTP trigger, and logs", () => {
    const chips = effectSummaryChips(sampleRun());
    expect(chips.map((c) => c.label)).toEqual([
      "56ms",
      "1 API call",
      "2 DB queries",
      "1 emit",
      "2 log lines",
    ]);
    expect(chips.map((c) => c.shortLabel)).toEqual([
      "56ms",
      "1 API",
      "2 DB",
      "1 emit",
      "2 logs",
    ]);
  });

  test("matches ops bookings.create shape (duration + 2 logs)", () => {
    const chips = effectSummaryChips(
      sampleRun({
        durationMs: 89,
        logs: [
          { level: "info", message: "booking started", at: 1_001 },
          { level: "info", message: "seats reserved", at: 1_080 },
        ],
      }),
    );
    expect(chips.map((c) => c.label)).toEqual([
      "89ms",
      "1 API call",
      "2 DB queries",
      "1 emit",
      "2 log lines",
    ]);
    expect(chips.find((c) => c.key === "db")?.detail).toContain("sql:");
    expect(chips.find((c) => c.key === "api")?.detail).toContain("HTTP trigger");
  });

  test("surfaces evaluated gates from the run ledger", () => {
    const chips = effectSummaryChips(sampleRun({ gates: ["member"] }));
    expect(chips.map((c) => c.label)).toEqual([
      "56ms",
      "1 API call",
      "1 gate",
      "2 DB queries",
      "1 emit",
      "2 log lines",
    ]);
    expect(chips.find((c) => c.key === "gates")?.detail).toContain("member");
  });

  test("omits API call chip for non-HTTP triggers", () => {
    const chips = effectSummaryChips(sampleRun({ trigger: "signal", effects: [], logs: [] }));
    expect(chips.map((c) => c.label)).toEqual(["56ms"]);
  });

  test("keeps non-SQL reads separate from DB queries", () => {
    const chips = effectSummaryChips(
      sampleRun({
        effects: [
          {
            kind: "read",
            resource: "kv:holds",
            timestamp: 1_003,
            duration: 2,
            reversibility: "none",
          },
          {
            kind: "read",
            resource: "sql:bookings",
            timestamp: 1_010,
            duration: 4,
            reversibility: "none",
          },
        ],
        logs: [],
      }),
    );
    expect(chips.map((c) => c.label)).toEqual([
      "56ms",
      "1 API call",
      "1 DB query",
      "1 read",
    ]);
  });
});

describe("traceGateInfos", () => {
  test("enriches run.gates from Manifest definitions", () => {
    const rows = traceGateInfos(["member", "missing"], {
      ...FLOWS_TEST_MANIFEST,
      gates: {
        member: { kind: "policy", description: "Signed-in member" },
      },
    });
    expect(rows).toEqual([
      { name: "member", kind: "policy", description: "Signed-in member" },
      { name: "missing", kind: null, description: null },
    ]);
  });

  test("keeps ledger order when Manifest is absent", () => {
    expect(traceGateInfos(["booking:create", "member"], null)).toEqual([
      { name: "booking:create", kind: null, description: null },
      { name: "member", kind: null, description: null },
    ]);
  });
});

describe("effectEventLabel", () => {
  test("labels SQL resources as DB query / DB write", () => {
    expect(
      effectEventLabel({ kind: "read", resource: "sql:bookings" }),
    ).toBe("DB query");
    expect(
      effectEventLabel({ kind: "write", resource: "sql:bookings" }),
    ).toBe("DB write");
    expect(effectEventLabel({ kind: "emit", resource: "order-placed" })).toBe("Emit");
  });
});

describe("traceRequestMeta", () => {
  test("reads method + path from Manifest http trigger", () => {
    expect(traceRequestMeta(FLOWS_TEST_MANIFEST, "bookings.create", "http")).toEqual({
      method: "POST",
      path: "/bookings",
      headline: "POST /bookings",
    });
  });

  test("signal trigger uses signal name, not an invented path", () => {
    expect(traceRequestMeta(FLOWS_TEST_MANIFEST, "fulfillment.onOrder", "signal")).toEqual({
      method: null,
      path: null,
      headline: "Signal · order-placed",
    });
  });
});

describe("Sheet Replay path", () => {
  test("executeTraceReplay posts the same body the row action uses", async () => {
    const run = sampleRun();
    let seen: unknown = null;
    const replay = async (body: unknown) => {
      seen = body;
      return {
        data: {
          ok: true as const,
          rootId: run.id,
          dryRun: false,
          at: 1,
          flow: run.flow,
        },
        error: null,
      };
    };
    const res = await executeTraceReplay(run, replay as typeof import("@/client.ts").tracesReplay);
    expect(seen).toEqual(replayRequestForRun(run));
    expect(seen).toEqual({ rootId: "run-42", dryRun: false });
    expect(res.data?.ok).toBe(true);
  });
});
