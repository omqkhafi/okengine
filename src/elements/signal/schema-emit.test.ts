/**
 * Signal `schema` enforced at emit time via Standard Schema (same as Flow `in`).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";

import {
  createPostgresSignalFake,
  memorySignalDriver,
  postgresSignalDriver,
  type SignalBus,
  type SignalDriver,
} from "../../drivers/index.ts";
import { OkeError, OKE_ERRORS } from "../../kernel/errors.ts";
import { signal, type SignalDecl } from "./declare.ts";

const openBuses: SignalBus[] = [];

afterEach(async () => {
  while (openBuses.length) {
    await openBuses.pop()!.close();
  }
});

async function openBus(
  driver: SignalDriver,
  decls: readonly SignalDecl[],
  extra: Record<string, unknown> = {},
): Promise<SignalBus> {
  const signals = new Map(decls.map((d) => [d.name, d]));
  const bus = await driver.open({ signals, ...extra });
  openBuses.push(bus);
  return bus;
}

const drivers: Array<{
  label: string;
  driver: SignalDriver;
  setup?: () => Record<string, unknown>;
}> = [
  { label: "memory", driver: memorySignalDriver },
  {
    label: "postgres",
    driver: postgresSignalDriver,
    setup: () => ({ sql: createPostgresSignalFake() }),
  },
];

for (const { label, driver, setup } of drivers) {
  describe(`signal schema emit · ${label}`, () => {
    test("invalid payload rejected at emit with OKE1043; valid succeeds", async () => {
      const orderPlaced = signal("order-placed", {
        delivery: "once",
        schema: z.object({
          orderId: z.string(),
          total: z.number(),
        }),
        retries: 1,
        deadLetter: true,
      });
      const bus = await openBus(driver, [orderPlaced], setup?.() ?? {});
      const got: unknown[] = [];
      await bus.subscribe("order-placed", "c1", async (m) => {
        got.push(m.payload);
      });

      let rejected: unknown;
      try {
        await bus.emit("order-placed", { orderId: "ord_1", total: "not-a-number" });
      } catch (err) {
        rejected = err;
      }
      expect(rejected).toBeInstanceOf(OkeError);
      const oke = rejected as OkeError;
      expect(oke.code).toBe(OKE_ERRORS.SIGNAL_SCHEMA.code);
      expect(oke.message).toContain("OKE1043");
      expect(oke.message).toContain("order-placed");

      // Nothing staged while invalid.
      await bus.drain();
      expect(got).toEqual([]);
      const statsBefore = await bus.inspect("order-placed");
      expect(statsBefore[0]?.pending).toBe(0);
      expect(statsBefore[0]?.delivered).toBe(0);

      await bus.emit("order-placed", { orderId: "ord_1", total: 49.5 });
      await bus.drain();
      expect(got).toEqual([{ orderId: "ord_1", total: 49.5 }]);
    });

    test("no schema: any payload still accepted", async () => {
      const loose = signal("hook", {
        delivery: "once",
        optional: true,
      });
      const bus = await openBus(driver, [loose], setup?.() ?? {});
      const got: unknown[] = [];
      await bus.subscribe("hook", "c1", async (m) => {
        got.push(m.payload);
      });
      await bus.emit("hook", { anything: true });
      await bus.drain();
      expect(got).toEqual([{ anything: true }]);
    });
  });
}
