import { describe, expect, test } from "bun:test";
import { memorySignalDriver } from "../drivers/index.ts";
import { createSignalRuntime, signal, type SignalDecl } from "../elements/signal.ts";
import { OkeError } from "./errors.ts";
import { createFx, createFxContext, signalReadRef } from "./fx.ts";

describe("fx.deadLetters", () => {
  test("returns dead-lettered messages for a declared signal read", async () => {
    const notify = signal.once("notify", { retries: 0, deadLetter: true });
    const runtime = openRuntime(notify);
    const bus = await runtime.start();
    await bus.subscribe("notify", "c1", async () => {
      throw new Error("smtp-down");
    });
    await runtime.emit("notify", { orderId: "ord_1" });
    await bus.drain();

    const { fx, ledger } = createFxContext({
      flow: "notifications.failed",
      effects: { reads: [signalReadRef("notify")] },
      signalRuntime: runtime,
    });

    const dead = await fx.deadLetters(notify);
    expect(dead).toHaveLength(1);
    expect(dead[0]!.payload).toEqual({ orderId: "ord_1" });
    expect(dead[0]!.status).toBe("dead");
    expect(dead[0]!.attempts).toBe(1);
    expect(dead[0]!.failures[0]!.message).toBe("smtp-down");
    expect(ledger.entries.map((e) => `${e.kind}:${e.resource}`)).toEqual(["read:signal:notify"]);

    await runtime.close();
  });

  test("undeclared and cross-signal reads throw OKE1001", async () => {
    const notify = signal.once("notify", { retries: 0, deadLetter: true });
    const other = signal.once("other", { retries: 0, deadLetter: true });
    const runtime = openRuntime(notify);
    const fx = createFx({
      flow: "notifications.failed",
      effects: { reads: [signalReadRef("notify")] },
      signalRuntime: runtime,
    });

    let err: unknown;
    try {
      await fx.deadLetters(other);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OkeError);
    const oke = err as OkeError;
    expect(oke.code).toBe(1001);
    expect(oke.causeText).toBe(
      'Flow "notifications.failed" reads "signal:other" without declaring it.',
    );
    expect(oke.fix).toBe('Add "signal:other" to this flow\'s effects.reads.');

    await runtime.close();
  });

  test("throws when no signal runtime is bound", async () => {
    const fx = createFx({
      flow: "notifications.failed",
      effects: { reads: [signalReadRef("notify")] },
    });
    await expect(fx.deadLetters("notify")).rejects.toThrow(
      "fx.deadLetters requires a bound signal runtime",
    );
  });
});

function openRuntime(decl: SignalDecl) {
  const runtime = createSignalRuntime({ driver: memorySignalDriver });
  runtime.register(decl);
  return runtime;
}
