import { describe, expect, test } from "bun:test";
import { SIGNALS_FIXTURE } from "./fixture.ts";
import { groupByPhysics } from "./group.ts";

describe("groupByPhysics", () => {
  test("one list grouped by delivery — not three tabs", () => {
    const groups = groupByPhysics(SIGNALS_FIXTURE);
    expect(groups.map((g) => g.delivery)).toEqual([
      "once",
      "broadcast",
      "live",
    ]);
    expect(groups.find((g) => g.delivery === "once")?.signals.length).toBe(2);
    expect(groups.find((g) => g.delivery === "broadcast")?.signals[0]?.name).toBe(
      "inventory-changed",
    );
  });

  test("retains orphaned signals in the list", () => {
    const groups = groupByPhysics(SIGNALS_FIXTURE);
    const once = groups.find((g) => g.delivery === "once");
    expect(once?.signals.some((s) => s.name === "legacy-shipped" && s.orphaned)).toBe(
      true,
    );
  });

  test("free-text filter dims across name and endpoints", () => {
    const groups = groupByPhysics(SIGNALS_FIXTURE, "fulfillment");
    expect(groups).toHaveLength(1);
    expect(groups[0]?.signals[0]?.name).toBe("order-placed");
  });
});
