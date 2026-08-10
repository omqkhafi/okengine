/**
 * Unit tests for the shared ui-next Console seed (Playwright + seeded Vite).
 */

import { describe, expect, test } from "bun:test";
import {
  createUiNextOperationRuns,
  createUiNextSeedRun,
  createUiNextSeedRuns,
  isConsoleNextSeeded,
  UI_NEXT_SEED_FAIL_RUN_ID,
  UI_NEXT_SEED_FEATURED_COUNT,
  UI_NEXT_SEED_FULFILL_RUN_ID,
  UI_NEXT_SEED_HOLDS_RUN_ID,
  UI_NEXT_SEED_OPERATION_COUNT,
  UI_NEXT_SEED_PAYMENTS_RUN_ID,
  UI_NEXT_SEED_RUN_ID,
  UI_NEXT_SEED_SUPPORT_RUN_ID,
  UI_NEXT_SEED_TOTAL_COUNT,
  UI_NEXT_SEEDED_MANIFEST,
  uiNextSeededSummary,
} from "./ui-next-seed.ts";

describe("ui-next seed", () => {
  test("manifest declares all eight elements", () => {
    expect(UI_NEXT_SEEDED_MANIFEST.app).toBe("skyport");
    expect(UI_NEXT_SEEDED_MANIFEST.flows).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.signals).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.stores).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.clocks).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.gates).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.vault).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.channels).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.ai).toBeDefined();

    expect(UI_NEXT_SEEDED_MANIFEST.flows?.["support.triage"]?.effects?.asks).toContain(
      "ticket-triage",
    );
    expect(UI_NEXT_SEEDED_MANIFEST.flows?.["holds.expire"]?.trigger?.every).toBe("10m");
    expect(UI_NEXT_SEEDED_MANIFEST.stores?.["cache"]?.facet).toBe("kv");
    expect(UI_NEXT_SEEDED_MANIFEST.clocks?.["expire-holds"]?.every).toBe("10m");
    expect(UI_NEXT_SEEDED_MANIFEST.vault?.["OPENAI_KEY"]).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.channels?.["support-reply"]?.medium).toBe("email");
    expect(UI_NEXT_SEEDED_MANIFEST.ai?.prompts?.["ticket-triage"]?.version).toBe(3);
    expect(UI_NEXT_SEEDED_MANIFEST.signals?.["hold-expired"]?.delivery).toBe("broadcast");
  });

  test("primary seed run keeps Playwright-stable id and rich ledger", () => {
    const run = createUiNextSeedRun(1_700_000_000_000);
    expect(run.id).toBe(UI_NEXT_SEED_RUN_ID);
    expect(run.flow).toBe("bookings.create");
    expect(run.unit).toBe("bookings");
    expect(run.parentId).toBe(UI_NEXT_SEED_PAYMENTS_RUN_ID);
    expect(run.tenant).toBe("org_skyport");
    expect(run.gates).toContain("booking:create");
    expect(run.effects.some((e) => e.kind === "emit" && e.resource === "order-placed")).toBe(true);
    expect(run.logs.length).toBeGreaterThan(0);
    expect(run.input).toEqual({ flightId: "SK-441", seats: 2, cabin: "economy" });
    expect(run.output).toEqual({ id: "bk_8f2a" });
  });

  test("featured runs cover chain + AI + clock elements", () => {
    const runs = createUiNextSeedRuns(1_700_000_000_000);
    expect(runs.length).toBe(UI_NEXT_SEED_TOTAL_COUNT);
    expect(UI_NEXT_SEED_TOTAL_COUNT).toBe(
      UI_NEXT_SEED_FEATURED_COUNT + UI_NEXT_SEED_OPERATION_COUNT,
    );
    expect(UI_NEXT_SEED_TOTAL_COUNT).toBeGreaterThanOrEqual(50);
    expect(UI_NEXT_SEED_TOTAL_COUNT).toBeLessThanOrEqual(100);

    const byId = new Map(runs.map((r) => [r.id, r]));
    const create = byId.get(UI_NEXT_SEED_RUN_ID);
    const fulfill = byId.get(UI_NEXT_SEED_FULFILL_RUN_ID);
    const payments = byId.get(UI_NEXT_SEED_PAYMENTS_RUN_ID);
    const fail = byId.get(UI_NEXT_SEED_FAIL_RUN_ID);
    const support = byId.get(UI_NEXT_SEED_SUPPORT_RUN_ID);
    const holds = byId.get(UI_NEXT_SEED_HOLDS_RUN_ID);

    expect(payments?.flow).toBe("payments.chargeBooking");
    expect(payments?.effects.some((e) => e.kind === "call")).toBe(true);
    expect(payments?.effects.some((e) => e.kind === "secret")).toBe(true);
    expect(create?.parentId).toBe(UI_NEXT_SEED_PAYMENTS_RUN_ID);
    expect(fulfill?.parentId).toBe(UI_NEXT_SEED_RUN_ID);
    expect(fulfill?.trigger).toBe("signal");
    expect(fulfill?.effects.some((e) => e.kind === "send")).toBe(true);
    expect(fail?.error?.code).toBe("FlightFull");
    expect(fail?.output).toBeUndefined();
    expect(support?.output).toMatchObject({ replyQueued: true, template: "support-reply" });
    expect(support?.effects.some((e) => e.kind === "ask")).toBe(true);
    expect(support?.effects.some((e) => e.kind === "secret" && e.resource === "OPENAI_KEY")).toBe(
      true,
    );
    expect(support?.cost).toBeGreaterThan(0);
    expect(holds?.trigger).toBe("every");
    expect(holds?.effects.some((e) => e.resource === "kv:holds")).toBe(true);
    expect(holds?.effects.some((e) => e.kind === "emit" && e.resource === "hold-expired")).toBe(
      true,
    );
  });

  test("operation traffic is deterministic and spans manifest flows", () => {
    const a = createUiNextOperationRuns(1_700_000_000_000);
    const b = createUiNextOperationRuns(1_700_000_000_000);
    expect(a.length).toBe(UI_NEXT_SEED_OPERATION_COUNT);
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id));

    const flows = new Set(a.map((r) => r.flow));
    expect(flows.has("bookings.create")).toBe(true);
    expect(flows.has("bookings.mine")).toBe(true);
    expect(flows.has("fulfillment.onOrder")).toBe(true);
    expect(flows.has("payments.chargeBooking")).toBe(true);
    expect(flows.has("support.triage") || flows.has("holds.expire")).toBe(true);

    const failed = a.filter((r) => r.error?.code === "FlightFull");
    expect(failed.length).toBeGreaterThan(0);

    const chained = a.filter((r) => r.parentId?.startsWith("pw-ops-create-"));
    expect(chained.length).toBeGreaterThan(0);
  });

  test("seeded env flag and summary are explicit", () => {
    const prev = process.env["OKE_CONSOLE_NEXT_SEEDED"];
    try {
      delete process.env["OKE_CONSOLE_NEXT_SEEDED"];
      expect(isConsoleNextSeeded()).toBe(false);
      process.env["OKE_CONSOLE_NEXT_SEEDED"] = "1";
      expect(isConsoleNextSeeded()).toBe(true);
      expect(uiNextSeededSummary()).toContain(UI_NEXT_SEED_RUN_ID);
      expect(uiNextSeededSummary()).toContain(String(UI_NEXT_SEED_TOTAL_COUNT));
      expect(uiNextSeededSummary()).toContain("8 elements");
    } finally {
      if (prev === undefined) delete process.env["OKE_CONSOLE_NEXT_SEEDED"];
      else process.env["OKE_CONSOLE_NEXT_SEEDED"] = prev;
    }
  });
});
