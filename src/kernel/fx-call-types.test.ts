/**
 * `fx.call(FlowDef)` is typed; a string name stays `Promise<unknown>`.
 */

import { describe, expect, test } from "bun:test";
import { flow } from "./flow.ts";
import { createFxContext, type Fx } from "./fx.ts";

describe("fx.call — FlowDef inference", () => {
  test("a flow handle types input and output; a string name does not", () => {
    const load = flow("notes.load", {
      do: async (input: { id: string }) => ({ id: input.id, title: "n" }),
    });
    const { fx } = createFxContext({
      flow: "notes.copy",
      effects: { calls: ["notes.load"] },
    });

    const typed: (id: string) => Promise<{ id: string; title: string }> = (id) =>
      fx.call(load, { id });
    const untyped: (name: string) => Promise<unknown> = (name) => fx.call(name, { id: "1" });

    expect(typeof typed).toBe("function");
    expect(typeof untyped).toBe("function");

    function _wrongInput(fxArg: Fx): void {
      // @ts-expect-error input must match the flow handler
      void fxArg.call(load, { id: 1 });
    }
    expect(typeof _wrongInput).toBe("function");
  });
});
