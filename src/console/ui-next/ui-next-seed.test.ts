/**
 * Unit tests for the shared ui-next Console seed (Playwright + seeded Vite).
 */

import { describe, expect, test } from "bun:test";
import {
  createUiNextSeedRun,
  isConsoleNextSeeded,
  UI_NEXT_SEED_RUN_ID,
  UI_NEXT_SEEDED_MANIFEST,
  uiNextSeededSummary,
} from "./ui-next-seed.ts";

describe("ui-next seed", () => {
  test("manifest includes bookings.create and fulfillment.onOrder", () => {
    expect(UI_NEXT_SEEDED_MANIFEST.flows?.["bookings.create"]).toBeDefined();
    expect(UI_NEXT_SEEDED_MANIFEST.flows?.["fulfillment.onOrder"]).toBeDefined();
  });

  test("seed run id and flow match Playwright assertions", () => {
    const run = createUiNextSeedRun(1_700_000_000_000);
    expect(run.id).toBe(UI_NEXT_SEED_RUN_ID);
    expect(run.flow).toBe("bookings.create");
    expect(run.unit).toBe("bookings");
    expect(run.endedAt).toBe(1_700_000_000_000);
    expect(run.startedAt).toBe(1_700_000_000_000 - 12);
  });

  test("seeded env flag and summary are explicit", () => {
    const prev = process.env["OKE_CONSOLE_NEXT_SEEDED"];
    try {
      delete process.env["OKE_CONSOLE_NEXT_SEEDED"];
      expect(isConsoleNextSeeded()).toBe(false);
      process.env["OKE_CONSOLE_NEXT_SEEDED"] = "1";
      expect(isConsoleNextSeeded()).toBe(true);
      expect(uiNextSeededSummary()).toContain(UI_NEXT_SEED_RUN_ID);
      expect(uiNextSeededSummary()).toContain("bookings.create");
    } finally {
      if (prev === undefined) delete process.env["OKE_CONSOLE_NEXT_SEEDED"];
      else process.env["OKE_CONSOLE_NEXT_SEEDED"] = prev;
    }
  });
});
