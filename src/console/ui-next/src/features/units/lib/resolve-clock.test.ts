/**
 * Soft-join cron/every flows → Manifest clock names.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../../../../../manifest/types.ts";
import { resolveClockForFlow } from "./resolve-clock.ts";

const SEED_LIKE: Manifest = {
  oke: "1.0",
  app: "clock-resolve-test",
  flows: {
    "holds.expire": {
      trigger: { every: "10m" },
      plane: "operator",
    },
    "ops.nightlyReconcile": {
      trigger: { cron: "0 3 * * *" },
      plane: "operator",
    },
    "orphan.tick": {
      trigger: { every: "5m" },
      plane: "operator",
    },
    "bookings.create": {
      trigger: { http: { method: "POST", path: "/bookings" } },
    },
  },
  clocks: {
    nightly: {
      cron: "0 3 * * *",
      timezone: "UTC",
      description: "Nightly booking reconcile",
    },
    "expire-holds": {
      every: "10m",
      timezone: "UTC",
      overridable: true,
      description: "Expire unpaid seat holds",
    },
  },
};

describe("resolveClockForFlow", () => {
  test("matches every-triggered flow by schedule equality", () => {
    expect(resolveClockForFlow(SEED_LIKE, "holds.expire")).toEqual({
      kind: "matched",
      clockName: "expire-holds",
      timezone: "UTC",
      description: "Expire unpaid seat holds",
      cron: null,
      every: "10m",
    });
  });

  test("matches cron-triggered flow by schedule equality", () => {
    expect(resolveClockForFlow(SEED_LIKE, "ops.nightlyReconcile")).toEqual({
      kind: "matched",
      clockName: "nightly",
      timezone: "UTC",
      description: "Nightly booking reconcile",
      cron: "0 3 * * *",
      every: null,
    });
  });

  test("matches by flow id suffix when clock name is the action segment", () => {
    const m: Manifest = {
      ...SEED_LIKE,
      clocks: {
        ...SEED_LIKE.clocks,
        expire: { every: "15m", timezone: "UTC" },
      },
      flows: {
        ...SEED_LIKE.flows,
        "holds.expire": { trigger: { every: "15m" } },
      },
    };
    // Name suffix `holds.expire` ends with `.expire` AND schedule matches `expire`.
    expect(resolveClockForFlow(m, "holds.expire")).toMatchObject({
      kind: "matched",
      clockName: "expire",
    });
  });

  test("falls back unmatched when no Manifest clock shares the schedule", () => {
    expect(resolveClockForFlow(SEED_LIKE, "orphan.tick")).toEqual({ kind: "unmatched" });
  });

  test("falls back unmatched when multiple clocks share the same schedule", () => {
    const ambiguous: Manifest = {
      ...SEED_LIKE,
      clocks: {
        a: { every: "10m", timezone: "UTC" },
        b: { every: "10m", timezone: "UTC" },
      },
    };
    expect(resolveClockForFlow(ambiguous, "holds.expire")).toEqual({ kind: "unmatched" });
  });

  test("HTTP / missing flows are unmatched", () => {
    expect(resolveClockForFlow(SEED_LIKE, "bookings.create")).toEqual({ kind: "unmatched" });
    expect(resolveClockForFlow(SEED_LIKE, "missing.flow")).toEqual({ kind: "unmatched" });
    expect(resolveClockForFlow(null, "holds.expire")).toEqual({ kind: "unmatched" });
  });
});
