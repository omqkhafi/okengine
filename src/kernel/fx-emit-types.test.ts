/**
 * Typed `fx.emit(SignalDecl<T>, payload)` vs untyped string-name emits.
 */

import { describe, expect, test } from "bun:test";
import { signal } from "../elements/signal/declare.ts";
import { createFxContext, type Fx } from "./fx.ts";

describe("fx.emit — SignalDecl payload inference", () => {
  test("exported handle type-checks a matching payload; string names stay unknown", () => {
    const orderPlaced = signal.once<{ orderId: string }>("order-placed");
    const { fx } = createFxContext({
      flow: "orders.create",
      effects: { emits: ["order-placed"] },
    });

    const typed: (s: typeof orderPlaced, p: { orderId: string }) => Promise<void> = (s, p) =>
      fx.emit(s, p);
    const untyped: (name: string, p: { extra: boolean }) => Promise<void> = (name, p) =>
      fx.emit(name, p);

    expect(typeof typed).toBe("function");
    expect(typeof untyped).toBe("function");

    function _wrongPayload(fxArg: Fx): void {
      // @ts-expect-error payload must match SignalDecl
      void fxArg.emit(orderPlaced, { orderId: 1 });
    }
    expect(typeof _wrongPayload).toBe("function");
  });
});
