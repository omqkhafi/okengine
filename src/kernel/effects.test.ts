import { describe, expect, test } from "bun:test";
import {
  createEffectLedger,
  EFFECT_KIND_TIERS,
  recordEffect,
  reversibilityOf,
  type EffectKind,
  type ReversibilityTier,
} from "./effects.ts";

describe("effects — reversibility tiers", () => {
  test("all seven effect kinds have the correct reversibility tier", () => {
    const expected: Record<EffectKind, ReversibilityTier> = {
      read: "none",
      write: "reversible",
      emit: "deferred",
      send: "irreversible",
      ask: "irreversible",
      secret: "capability",
      call: "portal",
    };

    expect(EFFECT_KIND_TIERS).toHaveLength(7);
    for (const { kind, reversibility } of EFFECT_KIND_TIERS) {
      expect(reversibility).toBe(expected[kind]);
      expect(reversibilityOf(kind)).toBe(expected[kind]);
    }
  });
});

describe("effects — ledger", () => {
  test("records kind, resource, timestamp, duration, reversibility in order", async () => {
    const ledger = createEffectLedger();
    let t = 1_000;
    const now = () => t;

    await recordEffect(ledger, "read", "sql:bookings", now, () => {
      t += 5;
      return "ok";
    });
    await recordEffect(ledger, "write", "sql:bookings", now, async () => {
      t += 10;
    });
    await recordEffect(ledger, "emit", "order-placed", now, async () => {
      t += 1;
    });

    expect(ledger.entries).toHaveLength(3);
    expect(ledger.entries.map((e) => e.kind)).toEqual([
      "read",
      "write",
      "emit",
    ]);
    expect(ledger.entries[0]).toMatchObject({
      kind: "read",
      resource: "sql:bookings",
      timestamp: 1_000,
      duration: 5,
      reversibility: "none",
    });
    expect(ledger.entries[1]).toMatchObject({
      kind: "write",
      resource: "sql:bookings",
      timestamp: 1_005,
      duration: 10,
      reversibility: "reversible",
    });
    expect(ledger.entries[2]).toMatchObject({
      kind: "emit",
      resource: "order-placed",
      timestamp: 1_015,
      duration: 1,
      reversibility: "deferred",
    });
  });

  test("clear empties the ledger", () => {
    const ledger = createEffectLedger();
    ledger.record({
      kind: "read",
      resource: "sql:x",
      timestamp: 0,
      duration: 0,
      reversibility: "none",
    });
    ledger.clear();
    expect(ledger.entries).toEqual([]);
  });
});
