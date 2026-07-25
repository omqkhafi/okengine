import { describe, expect, test } from "bun:test";
import { dryRunOffer } from "./dry-run.ts";
import { SIGNALS_FIXTURE } from "./fixture.ts";

describe("dryRunOffer", () => {
  test("offers dry-run when Manifest consumers are known", () => {
    const order = SIGNALS_FIXTURE.find((s) => s.name === "order-placed")!;
    expect(dryRunOffer(order)).toEqual({ ok: true });
  });

  test("refuses dry-run for orphaned signals", () => {
    const orphan = SIGNALS_FIXTURE.find((s) => s.name === "legacy-shipped")!;
    const offer = dryRunOffer(orphan);
    expect(offer.ok).toBe(false);
    if (offer.ok) return;
    expect(offer.reason).toContain("Orphaned");
  });
});
