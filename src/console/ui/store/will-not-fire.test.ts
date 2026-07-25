import { describe, expect, test } from "bun:test";
import { STORE_FIXTURE } from "./fixture.ts";
import { formatWillNotFire } from "./will-not-fire.ts";

describe("formatWillNotFire", () => {
  test("names signals and channels from Manifest writers", () => {
    const bookings = STORE_FIXTURE[0]!.children[0]!;
    const lines = formatWillNotFire(bookings.willNotFire);
    expect(lines.empty).toBe(false);
    expect(lines.lines.some((l) => l.includes("order-placed"))).toBe(true);
    expect(lines.lines.some((l) => l.includes("bookings.create"))).toBe(true);
  });

  test("names channels for fulfillment writers", () => {
    const shipments = STORE_FIXTURE[0]!.children[1]!;
    const lines = formatWillNotFire(shipments.willNotFire);
    expect(lines.lines.some((l) => l.includes("booking-confirmed"))).toBe(true);
  });
});
