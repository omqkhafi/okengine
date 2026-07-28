/**
 * Console Manifest Diff projection (console §9.12).
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../manifest/types.ts";
import type { WideEvent } from "../../runs/types.ts";
import {
  countRunsByFlowLastWeek,
  formatBlastLine,
  formatRunCount,
  formatWeeklyBill,
  projectManifestDiff,
  weeklyCostDeltaUsd,
  WEEK_MS,
} from "./diff.ts";

const NOW = 1_700_000_000_000;

function run(flow: string, startedAt: number, id = `${flow}-${startedAt}`): WideEvent {
  return {
    id,
    flow,
    trigger: "http",
    plane: "user",
    gates: [],
    cache: "none",
    effects: [],
    logs: [],
    durationMs: 10,
    startedAt,
    endedAt: startedAt + 10,
    dimensions: {},
  };
}

const BASELINE: Manifest = {
  oke: "1.0",
  app: "diff-console-test",
  flows: {
    "orders.notify": {
      plane: "user",
      gates: ["member"],
      effects: {},
    },
    "reports.export": {
      plane: "user",
      gates: ["staff"],
      in: { type: "object", properties: { id: { type: "string" } } },
    },
  },
  channels: {
    "order-shipped": { medium: "email" },
  },
};

describe("countRunsByFlowLastWeek", () => {
  test("counts only the trailing week from the real Runs store", () => {
    const runs = [
      run("orders.notify", NOW - 1_000),
      run("orders.notify", NOW - 2_000),
      run("orders.notify", NOW - WEEK_MS - 1),
      run("reports.export", NOW - 500),
    ];
    const counts = countRunsByFlowLastWeek(runs, NOW);
    expect(counts.get("orders.notify")).toBe(2);
    expect(counts.get("reports.export")).toBe(1);
  });
});

describe("formatWeeklyBill", () => {
  test("is a weekly bill, not a per-call delta", () => {
    expect(formatWeeklyBill(212)).toBe("+$212 per week");
    expect(formatWeeklyBill(0.018)).toBe("+$0.02 per week");
    expect(formatWeeklyBill(-38)).toBe("-$38 per week");
  });
});

describe("formatBlastLine", () => {
  test("multiplies a new send by real traffic", () => {
    const line = formatBlastLine({
      flowName: "orders.notify",
      runCount: 41_208,
      beforeFlow: { effects: {} },
      afterFlow: { effects: { sends: ["order-shipped"] } },
      channels: { "order-shipped": { medium: "email" } },
    });
    expect(line).toBe(
      "this flow ran 41,208 times last week, it sent nothing, and it will now email every caller",
    );
    expect(formatRunCount(41208)).toBe("41,208");
  });
});

describe("weeklyCostDeltaUsd", () => {
  test("rate × recent volume — email unit cost × run count", () => {
    const delta = weeklyCostDeltaUsd({
      beforeFlow: { effects: {} },
      afterFlow: { effects: { sends: ["order-shipped"] } },
      runCount: 41_208,
      channels: { "order-shipped": { medium: "email" } },
      costs: { email: 0.0001, any: 0.005 },
    });
    // 0.0001 × 41208 = 4.1208
    expect(delta).toBeCloseTo(4.1208, 4);
  });

  test("uses estimatePerCall when declared", () => {
    const delta = weeklyCostDeltaUsd({
      beforeFlow: { cost: { estimatePerCall: 0.01 } },
      afterFlow: { cost: { estimatePerCall: 0.02 } },
      runCount: 1000,
      channels: undefined,
      costs: {},
    });
    expect(delta).toBe(10);
  });
});

describe("projectManifestDiff", () => {
  test("empty without a baseline — does not invent a diff", () => {
    const projection = projectManifestDiff({
      before: null,
      after: BASELINE,
      now: NOW,
    });
    expect(projection.hasBaseline).toBe(false);
    expect(projection.changes).toEqual([]);
  });

  test("uses diffManifest categories — does not reclassify in the projection", () => {
    const after: Manifest = {
      ...BASELINE,
      flows: {
        ...BASELINE.flows,
        "orders.notify": {
          plane: "user",
          gates: ["member"],
          effects: { sends: ["order-shipped"] },
        },
        "reports.export": {
          plane: "user",
          gates: ["member"],
          in: {
            type: "object",
            required: ["id", "format"],
            properties: {
              id: { type: "string" },
              format: { type: "string" },
            },
          },
        },
      },
    };

    const runs = Array.from({ length: 100 }, (_, i) =>
      run("orders.notify", NOW - i * 1000, `n-${i}`),
    );

    const projection = projectManifestDiff({
      before: BASELINE,
      after,
      runs,
      now: NOW,
      costs: { email: 0.0001, any: 0.005 },
    });

    expect(projection.hasBaseline).toBe(true);
    expect(projection.changes.some((c) => c.category === "effect-widening")).toBe(true);
    expect(projection.changes.some((c) => c.category === "permission-widening")).toBe(true);
    expect(projection.changes.some((c) => c.category === "contract-breaking")).toBe(true);

    const send = projection.changes.find((c) => c.path.includes("sends") || c.blastLine !== null);
    expect(send?.runCountLastWeek).toBe(100);
    expect(send?.blastLine).toContain("ran 100 times last week");
    expect(send?.blastLine).toContain("sent nothing");
    expect(send?.blastLine).toContain("email every caller");
    expect(send?.weeklyBillLine).toMatch(/per week/);
  });

  test("CI gate: undeclared break is blocked; breaking: true is acknowledged", () => {
    const afterBlocked: Manifest = {
      ...BASELINE,
      flows: {
        "orders.notify": BASELINE.flows!["orders.notify"]!,
        "reports.export": {
          plane: "user",
          gates: ["staff"],
          // required field added — contract-breaking, no acknowledgement
          in: {
            type: "object",
            required: ["id", "format"],
            properties: {
              id: { type: "string" },
              format: { type: "string" },
            },
          },
        },
      },
    };

    const blocked = projectManifestDiff({
      before: BASELINE,
      after: afterBlocked,
      now: NOW,
    });
    const breakChange = blocked.changes.find(
      (c) => c.category === "contract-breaking" && c.flowName === "reports.export",
    );
    expect(breakChange?.ciGate).toBe("blocked");
    expect(blocked.blockedCount).toBeGreaterThanOrEqual(1);
    expect(blocked.acknowledgedCount).toBe(0);

    const afterAck: Manifest = {
      ...afterBlocked,
      flows: {
        ...afterBlocked.flows,
        "reports.export": {
          ...afterBlocked.flows!["reports.export"]!,
          breaking: true,
        },
      },
    };

    const ack = projectManifestDiff({
      before: BASELINE,
      after: afterAck,
      now: NOW,
    });
    const ackChange = ack.changes.find(
      (c) => c.category === "contract-breaking" && c.flowName === "reports.export",
    );
    expect(ackChange?.ciGate).toBe("acknowledged");
    expect(ack.acknowledgedCount).toBeGreaterThanOrEqual(1);
    expect(ack.blockedCount).toBe(0);
  });

  test("sorts by blast radius — contract-breaking first", () => {
    const after: Manifest = {
      ...BASELINE,
      flows: {
        "orders.notify": {
          plane: "user",
          // public — permission-widening
          effects: { sends: ["order-shipped"] },
        },
        "reports.export": {
          plane: "user",
          gates: ["staff"],
          in: {
            type: "object",
            required: ["id", "format"],
            properties: {
              id: { type: "string" },
              format: { type: "string" },
            },
          },
        },
        "health.ping": {
          plane: "user",
          source: "src/health.ts",
        },
      },
    };

    const projection = projectManifestDiff({
      before: BASELINE,
      after,
      now: NOW,
    });

    const categories = projection.changes.map((c) => c.category);
    const firstBreak = categories.indexOf("contract-breaking");
    const firstWiden = categories.indexOf("permission-widening");
    const firstEffect = categories.indexOf("effect-widening");
    const firstNoImpact = categories.indexOf("no-impact");
    if (firstBreak >= 0 && firstWiden >= 0) {
      expect(firstBreak).toBeLessThan(firstWiden);
    }
    if (firstWiden >= 0 && firstEffect >= 0) {
      expect(firstWiden).toBeLessThan(firstEffect);
    }
    if (firstEffect >= 0 && firstNoImpact >= 0) {
      expect(firstEffect).toBeLessThan(firstNoImpact);
    }
  });
});
