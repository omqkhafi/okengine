/**
 * Once-signal uniqueness (OKE1071) — two different Flows on `signal.once`.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { resetClocks } from "../elements/clock/declare.ts";
import { resetSignals, signal } from "../elements/signal/declare.ts";
import { oke } from "./app.ts";
import { OkeError } from "./errors.ts";
import { ONCE_SIGNAL_MULTI_FLOW } from "./errors-once-signal.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
  resetSignals();
  resetClocks();
});

describe("oke — ONCE_SIGNAL_MULTI_FLOW OKE1071", () => {
  test("two differently-named flows on the same once signal fail OKE1071", () => {
    const orderPlaced = signal.once("orders.placed");
    on(orderPlaced, flow("orders.charge", { do: () => ({ a: true }) }));
    on(orderPlaced, flow("orders.ship", { do: () => ({ b: true }) }));
    try {
      oke({ name: "t", autoBoot: false });
      expect.unreachable("oke() should throw OKE1071");
    } catch (err) {
      expect(err).toBeInstanceOf(OkeError);
      const okeErr = err as OkeError;
      expect(okeErr.code).toBe(1071);
      expect(okeErr.code).toBe(ONCE_SIGNAL_MULTI_FLOW.code);
      expect(okeErr.message).toMatch(/OKE1071/);
      expect(okeErr.causeText).toContain("orders.placed");
      expect(okeErr.causeText).toContain("orders.charge");
      expect(okeErr.causeText).toContain("orders.ship");
      expect(okeErr.fix).toMatch(/signal\.broadcast/);
    }
  });

  test("the same scenario with signal.broadcast does not fail", () => {
    const catalogChanged = signal.broadcast("catalog.changed");
    on(catalogChanged, flow("cache.invalidate", { do: () => ({ a: true }) }));
    on(catalogChanged, flow("search.reindex", { do: () => ({ b: true }) }));
    expect(() => oke({ name: "t", autoBoot: false })).not.toThrow();
  });

  test("two differently-named flows on signal.live do not fail OKE1071", () => {
    const status = signal.live("order-status", { optional: true });
    on(status, flow("orders.mirrorA", { do: () => ({ a: true }) }));
    on(status, flow("orders.mirrorB", { do: () => ({ b: true }) }));
    expect(() => oke({ name: "t", autoBoot: false })).not.toThrow();
  });

  test("a single flow bound to once boots with zero warnings", () => {
    const warnings: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };
    try {
      const emailTask = signal.once("tasks.email");
      on(emailTask, flow("workers.email", { do: () => ({ ok: true }) }));
      expect(() => oke({ name: "t", autoBoot: false })).not.toThrow();
      expect(warnings).toEqual([]);
    } finally {
      console.warn = orig;
    }
  });
});
