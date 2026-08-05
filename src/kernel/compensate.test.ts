/**
 * Durable compensation — terminal failure only; undo steps are distinct
 * journaled names that survive orphan resume without re-running forwards.
 */

import { describe, expect, test } from "bun:test";
import { createMemoryJournalStore } from "./journal.ts";
import type { JournalRuntime } from "./boot-bind/journal.ts";
import { flow } from "./flow.ts";
import { oke } from "./app.ts";
import { createRunsRuntime } from "../runs/runtime.ts";

function memoryJournal(store = createMemoryJournalStore()): JournalRuntime {
  return {
    store,
    instanceId: "test-inst",
    leaseMs: 30_000,
    driverId: "memory",
  };
}

describe("durable compensate", () => {
  test("throw commits journal failed and runs compensate undo steps", async () => {
    const store = createMemoryJournalStore();
    const undos: string[] = [];

    const pay = flow({
      name: "pay.charge",
      durable: true,
      do: async (_input: { amount: number }, fx) => {
        await fx.step("reserve", async () => "reserved");
        await fx.step("charge", async () => {
          throw new Error("card_declined");
        });
        return { ok: true as const };
      },
      compensate: async (_ctx, fx) => {
        await fx.step("undo:charge", async () => {
          undos.push("undo:charge");
        });
        await fx.step("undo:reserve", async () => {
          undos.push("undo:reserve");
        });
      },
    });

    const app = oke({
      name: "compensate-throw",
      env: "test",
      startScheduler: false,
      gate: { unguardedHttp: "allow" },
      elements: { journal: memoryJournal(store) },
    }).adopt(pay);

    await app.boot();
    const result = await app.execute(pay, { amount: 10 }, { kind: "internal" });
    expect(result.ctx.error).toBeDefined();

    const runs = await store.list();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("failed");
    expect(runs[0]!.error).toBe("card_declined");
    expect(undos).toEqual(["undo:charge", "undo:reserve"]);
    const stepNames = runs[0]!.entries
      .filter((e) => e.kind === "step")
      .map((e) => (e as { name: string }).name);
    expect(stepNames).toContain("reserve");
    expect(stepNames).toContain("undo:reserve");
    expect(stepNames).toContain("undo:charge");
  });

  test("compensate does not run on successful path", async () => {
    let compensated = 0;
    const store = createMemoryJournalStore();
    const ok = flow({
      name: "pay.ok",
      durable: true,
      do: async (_input, fx) => {
        await fx.step("a", () => "done");
        return { ok: true as const };
      },
      compensate: async () => {
        compensated += 1;
      },
    });

    const app = oke({
      name: "compensate-ok",
      env: "test",
      startScheduler: false,
      gate: { unguardedHttp: "allow" },
      elements: { journal: memoryJournal(store) },
    }).adopt(ok);
    await app.boot();
    const result = await app.execute(ok, {}, { kind: "internal" });
    expect(result.failure).toBeUndefined();
    expect(compensated).toBe(0);
    expect((await store.list())[0]!.status).toBe("completed");
  });

  test("WideEvent records thrown errors after classification fix", async () => {
    const runs = createRunsRuntime({ driver: "memory" });
    await runs.open();
    const store = createMemoryJournalStore();

    const boom = flow({
      name: "pay.boom",
      durable: true,
      do: async () => {
        throw new Error("boom");
      },
    });

    const app = oke({
      name: "compensate-runs",
      env: "test",
      startScheduler: false,
      gate: { unguardedHttp: "allow" },
      runs,
      elements: { journal: memoryJournal(store) },
    }).adopt(boom);
    await app.boot();
    await app.execute(boom, {}, { kind: "internal" });
    await runs.flush();

    const events = await runs.all();
    expect(events[0]!.error?.code).toBe("boom");
    expect((await store.list())[0]!.status).toBe("failed");
    await runs.close();
  });
});
