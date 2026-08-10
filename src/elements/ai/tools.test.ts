/**
 * Tool-calling through the same capability path as fx.call.
 */

import { describe, expect, test } from "bun:test";
import { createMockAiDriver } from "../../drivers/index.ts";
import { createFxContext } from "../../kernel/fx.ts";
import { ai, createAiRuntime } from "../ai.ts";

describe("fx.ask tools via fx.call", () => {
  test("model tool call dispatches through callTool (host fx.call)", async () => {
    const calls: Array<{ name: string; input: unknown }> = [];
    const smart = ai.model("smart");
    const prompt = smart.prompt("assistant", { out: { answer: "string" } });
    let turn = 0;
    const runtime = createAiRuntime({
      models: [smart],
      prompts: [prompt],
      defaultDriver: {
        id: "mock",
        async open() {
          return {
            driverId: "mock" as const,
            model: "smart",
            async complete() {
              turn++;
              if (turn === 1) {
                return {
                  text: "",
                  model: "smart",
                  driverId: "mock" as const,
                  toolCalls: [{ id: "t1", name: "lookup.booking", arguments: { id: "B9" } }],
                };
              }
              return {
                text: JSON.stringify({ answer: "found" }),
                raw: { answer: "found" },
                model: "smart",
                driverId: "mock" as const,
              };
            },
          };
        },
      },
    });

    const { fx, ledger } = createFxContext({
      flow: "host",
      effects: {
        asks: ["assistant"],
        calls: ["lookup.booking"],
      },
      aiRuntime: runtime,
      callHandler: async (name, input) => {
        calls.push({ name, input });
        return { booking: "B9", status: "ok" };
      },
    });

    const out = await fx.ask(prompt, { q: "status?" }, { tools: ["lookup.booking"], maxSteps: 4 });
    expect(out).toEqual({ answer: "found", via: "smart" });
    expect(calls).toEqual([{ name: "lookup.booking", input: { id: "B9" } }]);
    expect(ledger.entries.some((e) => e.kind === "ask" && e.resource === "assistant")).toBe(true);
    expect(
      ledger.entries.some(
        (e) => e.kind === "call" && e.resource === "lookup.booking" && e.reversibility === "portal",
      ),
    ).toBe(true);
  });

  test("undeclared tool call is denied by capability (no extra authority)", async () => {
    const smart = ai.model("smart");
    const prompt = smart.prompt("assistant");
    const runtime = createAiRuntime({
      models: [smart],
      prompts: [prompt],
      defaultDriver: createMockAiDriver({
        "*": {
          __toolCalls: [{ id: "t1", name: "secret.wipe", arguments: {} }],
        },
      }),
    });

    const { fx } = createFxContext({
      flow: "host",
      effects: {
        asks: ["assistant"],
        // deliberately omit calls: ["secret.wipe"]
        calls: [],
      },
      aiRuntime: runtime,
      callHandler: async () => ({ wiped: true }),
    });

    await expect(
      fx.ask(prompt, "wipe please", { tools: ["secret.wipe"], maxSteps: 1 }),
    ).rejects.toThrow();
  });
});
