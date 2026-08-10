/**
 * Unit tests for waterfall bar hover tooltip content.
 */

import { describe, expect, test } from "bun:test";
import { waterfallBars } from "./waterfall-bars.ts";
import { waterfallBarTooltip } from "./waterfall-tooltip.ts";

describe("waterfallBarTooltip", () => {
  test("includes kind label, resource, exact duration, and start offset", () => {
    const bars = waterfallBars(
      [
        {
          kind: "read",
          resource: "sql:bookings",
          timestamp: 1_003,
          duration: 9,
          reversibility: "none",
        },
        {
          kind: "emit",
          resource: "order-placed",
          timestamp: 1_036,
          duration: 5,
          reversibility: "deferred",
        },
      ],
      1_000,
      56,
    );
    expect(waterfallBarTooltip(bars[0]!)).toBe("DB query · sql:bookings · 9ms · +3ms");
    expect(waterfallBarTooltip(bars[1]!)).toBe("Emit · order-placed · 5ms · +36ms");
  });

  test("uses DB write label for sql write effects", () => {
    const bars = waterfallBars(
      [
        {
          kind: "write",
          resource: "sql:bookings",
          timestamp: 1_014,
          duration: 18,
          reversibility: "reversible",
        },
      ],
      1_000,
      56,
    );
    expect(waterfallBarTooltip(bars[0]!)).toBe("DB write · sql:bookings · 18ms · +14ms");
  });
});
