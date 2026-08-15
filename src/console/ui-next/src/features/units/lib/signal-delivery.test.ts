/**
 * Unit tests for signal delivery physics specs.
 */

import { describe, expect, test } from "bun:test";
import { Activity03Icon, Share08Icon, Target01Icon } from "@hugeicons/core-free-icons";
import { SIGNAL_DELIVERIES, SIGNAL_DELIVERY_SPECS, signalDeliverySpec } from "./signal-delivery.ts";

describe("signalDeliverySpec", () => {
  test("covers the three mandatory physics", () => {
    expect(SIGNAL_DELIVERIES).toEqual(["once", "broadcast", "live"]);
    expect(signalDeliverySpec("once")?.label).toBe("once");
    expect(signalDeliverySpec("broadcast")?.label).toBe("broadcast");
    expect(signalDeliverySpec("live")?.label).toBe("live");
    expect(signalDeliverySpec(null)).toBeNull();
    expect(signalDeliverySpec(undefined)).toBeNull();
  });

  test("tints each physics so the Units tree can tell them apart", () => {
    const classes = SIGNAL_DELIVERIES.map((d) => SIGNAL_DELIVERY_SPECS[d].wellClass);
    expect(new Set(classes).size).toBe(3);
  });

  test("uses a distinct glyph per physics (docs CircleDot / Share2 / Activity)", () => {
    expect(SIGNAL_DELIVERY_SPECS.once.icon).toBe(Target01Icon);
    expect(SIGNAL_DELIVERY_SPECS.broadcast.icon).toBe(Share08Icon);
    expect(SIGNAL_DELIVERY_SPECS.live.icon).toBe(Activity03Icon);
  });
});
