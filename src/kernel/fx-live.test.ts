import { describe, expect, test } from "bun:test";
import { memorySignalDriver } from "../drivers/index.ts";
import { createSignalRuntime, signal, type SignalDecl } from "../elements/signal.ts";
import { withAbortSignal } from "./abort-scope.ts";
import { OkeError } from "./errors.ts";
import { createFx, createFxContext, isSseFrame, signalReadRef } from "./fx.ts";

describe("fx.live", () => {
  test("undeclared signal read throws OKE1001", async () => {
    const orderStatus = signal("order-status", { delivery: "live", optional: true });
    const runtime = openRuntime(orderStatus);
    const fx = createFx({
      flow: "orders.events",
      effects: { reads: [signalReadRef("order-status")] },
      signalRuntime: runtime,
    });
    const other = signal("other-status", { delivery: "live", optional: true });
    let err: unknown;
    try {
      const stream = fx.live(other);
      await stream.chunks[Symbol.asyncIterator]().next();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(OkeError);
    const oke = err as OkeError;
    expect(oke.code).toBe(1001);
    expect(oke.causeText).toBe(
      'Flow "orders.events" reads "signal:other-status" without declaring it.',
    );
    await runtime.close();
  });

  test("throws when no signal runtime is bound", async () => {
    const fx = createFx({
      flow: "orders.events",
      effects: { reads: [signalReadRef("order-status")] },
    });
    const stream = fx.live("order-status");
    await expect(stream.chunks[Symbol.asyncIterator]().next()).rejects.toThrow(
      "fx.live requires a bound signal runtime",
    );
  });

  test("ALS abort unsubscribes the live handler", async () => {
    const orderStatus = signal("order-status", { delivery: "live", optional: true });
    const runtime = openRuntime(orderStatus);
    const bus = await runtime.start();
    const { fx } = createFxContext({
      flow: "orders.events",
      effects: { reads: [signalReadRef("order-status")] },
      signalRuntime: runtime,
    });

    const ctrl = new AbortController();
    await withAbortSignal(ctrl.signal, async () => {
      const stream = fx.live(orderStatus);
      const it = stream.chunks[Symbol.asyncIterator]();
      const pending = it.next();
      const started = Date.now();
      while ((await bus.inspect("order-status"))[0]?.connections !== 1) {
        if (Date.now() - started > 500) throw new Error("live handler did not attach");
        await new Promise((r) => setTimeout(r, 5));
      }
      ctrl.abort();
      const step = await pending;
      expect(step.done).toBe(true);
    });

    const after = await bus.inspect("order-status");
    expect(after[0]?.connections).toBe(0);
    await runtime.close();
  });

  test("yields branded SSE frames with id + payload", async () => {
    const orderStatus = signal("order-status", { delivery: "live", optional: true });
    const runtime = openRuntime(orderStatus);
    const bus = await runtime.start();
    await runtime.emit("order-status", { orderId: "ord_1", status: "placed" });
    await bus.drain();

    const { fx, ledger } = createFxContext({
      flow: "orders.events",
      effects: { reads: [signalReadRef("order-status")] },
      signalRuntime: runtime,
    });
    const stream = fx.live(orderStatus);
    const it = stream.chunks[Symbol.asyncIterator]();
    const step = await it.next();
    expect(step.done).toBe(false);
    expect(isSseFrame(step.value)).toBe(true);
    if (isSseFrame(step.value)) {
      expect(step.value.data).toEqual({ orderId: "ord_1", status: "placed" });
      expect(typeof step.value.id).toBe("string");
    }
    expect(ledger.entries.map((e) => `${e.kind}:${e.resource}`)).toEqual([
      "read:signal:order-status",
    ]);
    await it.return?.();
    await runtime.close();
  });
});

function openRuntime(decl: SignalDecl) {
  const runtime = createSignalRuntime({ driver: memorySignalDriver });
  runtime.register(decl);
  return runtime;
}
