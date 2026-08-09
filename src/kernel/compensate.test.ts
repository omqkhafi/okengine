/**
 * Durable compensation — terminal failure only; undo steps are distinct
 * journaled names that survive orphan resume without re-running forwards.
 */

import { describe, expect, test } from "bun:test";
import { createMemoryJournalStore, createJournal } from "./journal.ts";
import type { JournalRuntime } from "./boot-bind/journal.ts";
import { flow } from "./flow.ts";
import { oke } from "./app.ts";
import { createRunsRuntime } from "../runs/runtime.ts";
import { runDurable } from "../elements/clock/durable.ts";
import { fail } from "./errors.ts";

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

    const pay = flow("pay.charge", {
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
    const ok = flow("pay.ok", {
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

    const boom = flow("pay.boom", {
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

  test("per-step { undo } runs LIFO and skips the failed step", async () => {
    const store = createMemoryJournalStore();
    const undos: string[] = [];

    const pay = flow("pay.perStep", {
      durable: true,
      do: async (_input: { orderId: string }, fx) => {
        await fx.step("reserve", () => "reserved", {
          undo: () => {
            undos.push("undo:reserve");
          },
        });
        await fx.step(
          "charge",
          () => {
            throw new Error("card_declined");
          },
          {
            undo: () => {
              undos.push("undo:charge");
            },
          },
        );
        return true;
      },
    });

    const app = oke({
      name: "compensate-per-step",
      env: "test",
      startScheduler: false,
      gate: { unguardedHttp: "allow" },
      elements: { journal: memoryJournal(store) },
    }).adopt(pay);
    await app.boot();
    await app.execute(pay, { orderId: "o1" }, { kind: "internal" });

    expect(undos).toEqual(["undo:reserve"]);
    const stepNames = (await store.list())[0]!.entries
      .filter((e) => e.kind === "step")
      .map((e) => (e as { name: string }).name);
    expect(stepNames).toEqual(["reserve", "undo:reserve"]);
    expect((await store.list())[0]!.status).toBe("failed");
  });

  test("per-step undo receives the journaled step value", async () => {
    const store = createMemoryJournalStore();
    let refunded: unknown;

    const pay = flow("pay.value", {
      durable: true,
      do: async (_input, fx) => {
        await fx.step("charge", () => ({ id: "ch_1" }), {
          undo: (intent) => {
            refunded = intent;
          },
        });
        throw new Error("after_charge");
      },
    });

    const app = oke({
      name: "compensate-value",
      env: "test",
      startScheduler: false,
      gate: { unguardedHttp: "allow" },
      elements: { journal: memoryJournal(store) },
    }).adopt(pay);
    await app.boot();
    await app.execute(pay, {}, { kind: "internal" });
    expect(refunded).toEqual({ id: "ch_1" });
  });

  test("auto undos then flow.compensate", async () => {
    const store = createMemoryJournalStore();
    const order: string[] = [];

    const pay = flow("pay.both", {
      durable: true,
      do: async (_input, fx) => {
        await fx.step("reserve", () => "ok", {
          undo: () => {
            order.push("auto:reserve");
          },
        });
        throw new Error("boom");
      },
      compensate: async (_ctx, fx) => {
        await fx.step("undo:extra", async () => {
          order.push("hook:extra");
        });
      },
    });

    const app = oke({
      name: "compensate-both",
      env: "test",
      startScheduler: false,
      gate: { unguardedHttp: "allow" },
      elements: { journal: memoryJournal(store) },
    }).adopt(pay);
    await app.boot();
    await app.execute(pay, {}, { kind: "internal" });
    expect(order).toEqual(["auto:reserve", "hook:extra"]);
  });

  test("fx.fail triggers compensate on execute", async () => {
    const store = createMemoryJournalStore();
    const undos: string[] = [];

    const pay = flow("pay.fail", {
      durable: true,
      do: async (_input, fx) => {
        await fx.step("reserve", () => "ok", {
          undo: () => {
            undos.push("undo:reserve");
          },
        });
        return fail("Declined", {});
      },
    });

    const app = oke({
      name: "compensate-fx-fail",
      env: "test",
      startScheduler: false,
      gate: { unguardedHttp: "allow" },
      elements: { journal: memoryJournal(store) },
    }).adopt(pay);
    await app.boot();
    const result = await app.execute(pay, {}, { kind: "internal" });
    expect(result.failure?.error.code).toBe("Declined");
    expect(undos).toEqual(["undo:reserve"]);
    expect((await store.list())[0]!.status).toBe("failed");
  });

  test("runDurable: fx.fail triggers compensate", async () => {
    const store = createMemoryJournalStore();
    const undos: string[] = [];
    const pay = flow("pay.durableFail", {
      durable: true,
      do: async (_input, fx) => {
        await fx.step("reserve", () => "ok", {
          undo: () => {
            undos.push("undo:reserve");
          },
        });
        return fail("Declined", {});
      },
    });

    const result = await runDurable({ flow: pay, journalStore: store });
    expect(result.status).toBe("failed");
    expect(undos).toEqual(["undo:reserve"]);
  });

  test("runDurable refuses resume of failed runs", async () => {
    const store = createMemoryJournalStore();
    let runs = 0;
    const pay = flow("pay.terminal", {
      durable: true,
      do: async () => {
        runs += 1;
        throw new Error("boom");
      },
    });
    const first = await runDurable({ flow: pay, journalStore: store });
    expect(first.status).toBe("failed");
    expect(runs).toBe(1);
    const second = await runDurable({
      flow: pay,
      journalStore: store,
      runId: first.status === "failed" ? first.runId : "",
    });
    expect(second.status).toBe("failed");
    expect(runs).toBe(1); // do must not re-enter
  });

  test("orphan mid-undo resumes compensating without forward re-entry", async () => {
    const store = createMemoryJournalStore();
    const forward: string[] = [];
    const undos: string[] = [];
    const now = () => 1_000;

    const pay = flow("pay.midUndo", {
      durable: true,
      do: async (_input, fx) => {
        await fx.step(
          "reserve",
          () => {
            forward.push("reserve");
            return "r";
          },
          {
            undo: () => {
              undos.push("undo:reserve");
            },
          },
        );
        await fx.step(
          "charge",
          () => {
            forward.push("charge");
            return "c";
          },
          {
            undo: () => {
              undos.push("undo:charge");
            },
          },
        );
        return true;
      },
    });

    // Seed: forwards done, first undo journaled, status compensating (crash mid-phase).
    await store.put({
      id: "mid-undo",
      flow: "pay.midUndo",
      input: {},
      status: "compensating",
      error: "after_steps",
      entries: [
        { kind: "step", name: "reserve", value: "r", at: now() },
        { kind: "step", name: "charge", value: "c", at: now() },
        { kind: "step", name: "undo:charge", value: undefined, at: now() },
      ],
      createdAt: now(),
      updatedAt: now(),
    });

    const second = await runDurable({
      flow: pay,
      journalStore: store,
      runId: "mid-undo",
      now,
    });
    expect(second.status).toBe("failed");
    expect(forward).toEqual([]); // registration pass only — no new forward work
    expect(undos).toEqual(["undo:reserve"]);
    const names = (await store.get("mid-undo"))!.entries
      .filter((e) => e.kind === "step")
      .map((e) => (e as { name: string }).name);
    expect(names).toEqual(["reserve", "charge", "undo:charge", "undo:reserve"]);
  });

  test("flow.retry does not undo between attempts", async () => {
    const store = createMemoryJournalStore();
    const undos: string[] = [];
    let attempts = 0;

    const pay = flow("pay.retryUndo", {
      durable: true,
      retry: { retries: 2, delay: 0, jitter: false },
      do: async (_input, fx) => {
        await fx.step("reserve", () => "ok", {
          undo: () => {
            undos.push("undo:reserve");
          },
        });
        attempts += 1;
        if (attempts < 3) throw new Error("transient");
        return true;
      },
    });

    const result = await runDurable({ flow: pay, journalStore: store });
    expect(result.status).toBe("completed");
    expect(undos).toEqual([]);
    expect(attempts).toBe(3);
  });

  test("duplicate forward step name throws", async () => {
    const store = createMemoryJournalStore();
    const journal = createJournal({ store });
    const session = await journal.start("dup");
    await session.step("a", () => 1);
    try {
      await session.step("a", () => 2);
      expect.unreachable();
    } catch (err) {
      expect(String(err)).toMatch(/duplicate step name/);
    }
  });
});
