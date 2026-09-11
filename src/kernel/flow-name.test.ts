/**
 * Nameless Flow inherits Signal/Clock trigger names; duplicates fail OKE1070.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { clock, resetClocks } from "../elements/clock/declare.ts";
import { resetSignals, signal } from "../elements/signal/declare.ts";
import { oke } from "./app.ts";
import { OkeError } from "./errors.ts";
import { FLOW_NAME_DUPLICATE } from "./errors-flow-name.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { stampFlowName } from "./stamp-http.ts";
import { http } from "./triggers.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
  resetSignals();
  resetClocks();
});

describe("on() — Signal/Clock name inheritance", () => {
  test("nameless flow inherits inline signal.once name", () => {
    const bound = on(
      signal.once("link-clicked"),
      flow({
        do: () => ({ ok: true }),
      }),
    );
    expect(bound.name).toBe("link-clicked");
  });

  test("nameless flow inherits clock.every name", () => {
    const bound = on(
      clock.every("cleanup", "10m"),
      flow({
        do: () => ({ ok: true }),
      }),
    );
    expect(bound.name).toBe("cleanup");
  });

  test("explicit flow name wins over the trigger name", () => {
    const bound = on(
      signal.once("order-placed"),
      flow("orders.fulfill", { do: () => ({ ok: true }) }),
    );
    expect(bound.name).toBe("orders.fulfill");
  });

  test("HTTP does not inherit a name from the trigger", () => {
    const bound = on(
      http.post("/notes"),
      flow({
        do: () => ({ ok: true }),
      }),
    );
    expect(bound.name).toBe("");
  });

  test("file-tree stamp overwrites a trigger-inherited name", () => {
    const bound = on(
      signal.once("note-created"),
      flow({
        do: () => ({ ok: true }),
      }),
    );
    expect(bound.name).toBe("note-created");
    stampFlowName(bound, "notes.onCreated");
    expect(bound.name).toBe("notes.onCreated");
  });
});

describe("oke — FLOW_NAME_DUPLICATE OKE1070", () => {
  test("two nameless inheritances of the same trigger name fail at construction", () => {
    const ping = signal.once("health.ping");
    on(ping, flow({ do: () => ({ a: true }) }));
    on(ping, flow({ do: () => ({ b: true }) }));
    try {
      oke({ name: "t", autoBoot: false });
      expect.unreachable("oke() should throw OKE1070");
    } catch (err) {
      expect(err).toBeInstanceOf(OkeError);
      const okeErr = err as OkeError;
      expect(okeErr.code).toBe(1070);
      expect(okeErr.code).toBe(FLOW_NAME_DUPLICATE.code);
      expect(okeErr.message).toMatch(/OKE1070/);
    }
  });

  test("two explicit flows with the same name fail OKE1070", () => {
    on(signal.once("a"), flow("shared", { do: () => 1 }));
    on(clock.every("b", "1h"), flow("shared", { do: () => 2 }));
    expect(() => oke({ name: "t", autoBoot: false })).toThrow(/OKE1070/);
  });

  test("the same flow object bound twice is not a duplicate", () => {
    const shared = flow("shared.work", { do: (input: { n: number }) => input.n });
    on(http.post("/work"), shared);
    on(signal.once("order-placed"), shared);
    expect(() => oke({ name: "t", autoBoot: false })).not.toThrow();
  });
});
