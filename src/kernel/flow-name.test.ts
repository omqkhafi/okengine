/**
 * Nameless Signal/Clock consumers fail OKE1072; duplicate names fail OKE1070.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { clock, resetClocks } from "../elements/clock/declare.ts";
import { resetSignals, signal } from "../elements/signal/declare.ts";
import { oke } from "./app.ts";
import { OkeError } from "./errors.ts";
import { FLOW_NAME_DUPLICATE, FLOW_UNNAMED } from "./errors-flow-name.ts";
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

describe("on() — Signal/Clock names stay explicit or tree-stamped", () => {
  test("nameless flow does not inherit an inline signal.once name", () => {
    const bound = on(
      signal.once("link-clicked"),
      flow({
        do: () => ({ ok: true }),
      }),
    );
    expect(bound.name).toBe("");
  });

  test("nameless flow does not inherit a clock.every name", () => {
    const bound = on(
      clock.every("cleanup", "10m"),
      flow({
        do: () => ({ ok: true }),
      }),
    );
    expect(bound.name).toBe("");
  });

  test("explicit flow name is independent of the trigger name", () => {
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

  test("file-tree stamp fills a nameless Signal consumer", () => {
    const bound = on(
      signal.once("note-created"),
      flow({
        do: () => ({ ok: true }),
      }),
    );
    expect(bound.name).toBe("");
    stampFlowName(bound, "notes.onCreated");
    expect(bound.name).toBe("notes.onCreated");
  });
});

describe("oke — FLOW_UNNAMED OKE1072", () => {
  test("nameless flow({ do }) on signal.once fails OKE1072", () => {
    on(
      signal.once("link-clicked"),
      flow({
        do: () => ({ ok: true }),
      }),
    );
    try {
      oke({ name: "t", autoBoot: false });
      expect.unreachable("oke() should throw OKE1072");
    } catch (err) {
      expect(err).toBeInstanceOf(OkeError);
      const okeErr = err as OkeError;
      expect(okeErr.code).toBe(1072);
      expect(okeErr.code).toBe(FLOW_UNNAMED.code);
      expect(okeErr.message).toMatch(/OKE1072/);
      expect(okeErr.causeText).toContain("signal");
      expect(okeErr.causeText).toContain("link-clicked");
      expect(okeErr.message).toContain("src/flows/<unit>/");
      expect(okeErr.message).toContain("export const");
    }
  });

  test("nameless flow({ do }) on signal.broadcast fails OKE1072", () => {
    on(
      signal.broadcast("catalog.changed"),
      flow({
        do: () => ({ ok: true }),
      }),
    );
    expect(() => oke({ name: "t", autoBoot: false })).toThrow(/OKE1072/);
  });

  test("nameless flow({ do }) on signal.live fails OKE1072", () => {
    on(
      signal.live("order-status", { optional: true }),
      flow({
        do: () => ({ ok: true }),
      }),
    );
    expect(() => oke({ name: "t", autoBoot: false })).toThrow(/OKE1072/);
  });

  test("nameless flow({ do }) on clock.every fails OKE1072", () => {
    on(
      clock.every("cleanup", "10m"),
      flow({
        do: () => ({ ok: true }),
      }),
    );
    expect(() => oke({ name: "t", autoBoot: false })).toThrow(/OKE1072/);
  });
});

describe("oke — FLOW_NAME_DUPLICATE OKE1070", () => {
  test("two explicit flows with the same name fail OKE1070", () => {
    on(signal.once("a"), flow("shared", { do: () => 1 }));
    on(clock.every("b", "1h"), flow("shared", { do: () => 2 }));
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

  test("the same flow object bound twice is not a duplicate", () => {
    const shared = flow("shared.work", { do: (input: { n: number }) => input.n });
    on(http.post("/work"), shared);
    on(signal.once("order-placed"), shared);
    expect(() => oke({ name: "t", autoBoot: false })).not.toThrow();
  });

  test("two differently-named flows on the same clock do not fail OKE1070", () => {
    const tick = clock.every("metrics.tick", "1h");
    on(tick, flow("ops.sweep", { do: () => 1 }));
    on(tick, flow("ops.report", { do: () => 2 }));
    expect(() => oke({ name: "t", autoBoot: false })).not.toThrow();
  });
});
