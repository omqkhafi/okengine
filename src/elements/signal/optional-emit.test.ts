/**
 * Zero-subscriber emit — OKE1042 when optional is unset/false; allow when true.
 */

import { afterEach, describe, expect, test } from "bun:test";

import {
  createPostgresSignalFake,
  memorySignalDriver,
  postgresSignalDriver,
  type SignalBus,
  type SignalDriver,
} from "../../drivers/index.ts";
import { OkeError } from "../../kernel/errors.ts";
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
  const bus = await driver.open({
    signals: new Map(decls.map((d) => [d.name, d])),
    ...extra,
  });
  openBuses.push(bus);
  return bus;
}

for (const { label, driver, setup } of [
  { label: "memory", driver: memorySignalDriver, setup: () => ({}) },
  {
    label: "postgres",
    driver: postgresSignalDriver,
    setup: () => ({ sql: createPostgresSignalFake() }),
  },
] as const) {
  describe(`signal optional emit · ${label}`, () => {
    test("optional unset/false: emit with zero subscribers throws OKE1042", async () => {
      const once = signal.once("order-placed");
      expect(once.optional).toBe(false);
      const bus = await openBus(driver, [once], setup());

      let err: unknown;
      try {
        await bus.emit("order-placed", { id: "1" });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(OkeError);
      expect((err as OkeError).code).toBe(1042);
      expect((err as Error).message).toContain("OKE1042");
      expect((err as Error).message).toContain("no subscriber");
    });

    test("optional: true allows emit with zero subscribers", async () => {
      const once = signal.once("hook", { optional: true });
      const bus = await openBus(driver, [once], setup());
      await bus.emit("hook", { ok: true });
      await bus.drain();
      const stats = await bus.inspect("hook");
      expect(stats[0]?.pending).toBe(1);
    });
  });
}
