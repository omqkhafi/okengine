/**
 * Agents used as tools — cost rolls up, depth stops, parent run id is stamped.
 */

import { describe, expect, test } from "bun:test";
import type { AiCompleteOptions } from "../../drivers/ai-types.ts";
import { ai, createAiRuntime } from "../ai.ts";
import { createFxContext } from "../../kernel/fx.ts";

describe("agents as tools", () => {
  test("child cap is the min of its budget and the parent remaining", async () => {
    let childCalls = 0;
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [
        ai.agent("lookup", {
          model: "smart",
          maxSteps: 4,
          tools: ["notes.read"],
          budget: { maxCostPerRun: 1 },
        }),
        ai.agent("support", {
          model: "smart",
          maxSteps: 2,
          tools: ["lookup"],
          budget: { maxCostPerRun: 0.2 },
        }),
      ],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete(opts: AiCompleteOptions) {
            const tool = opts.tools?.[0]?.name;
            if (tool === "lookup") {
              return {
                text: "",
                raw: {},
                model: "smart",
                driverId: "mock",
                usage: { cost: 0 },
                toolCalls: [{ id: "p1", name: "lookup", arguments: { q: "a" } }],
              };
            }
            childCalls += 1;
            return {
              text: "",
              raw: {},
              model: "smart",
              driverId: "mock",
              usage: { cost: 0.25 },
              toolCalls: [{ id: `c${childCalls}`, name: "notes.read", arguments: {} }],
            };
          },
        },
      },
      callFlow: async () => ({ ok: true }),
    });
    const result = await runtime.runAgent("support", { message: "find it" });
    expect(childCalls).toBe(1);
    expect(result.stopReason).toBe("budget");
    expect(result.cost).toBe(0.25);
  });

  test("depth 3 refuses a fourth level and stamps parentRunId", async () => {
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [
        ai.agent("d", { model: "smart", maxSteps: 1, tools: [] }),
        ai.agent("c", { model: "smart", maxSteps: 2, tools: ["d"] }),
        ai.agent("b", { model: "smart", maxSteps: 2, tools: ["c"] }),
        ai.agent("a", { model: "smart", maxSteps: 2, tools: ["b"] }),
      ],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete(opts: AiCompleteOptions) {
            const name = opts.tools?.[0]?.name;
            if (!name) return { text: "leaf", raw: {}, model: "smart", driverId: "mock" };
            return {
              text: "",
              raw: {},
              model: "smart",
              driverId: "mock",
              toolCalls: [{ id: `call-${name}`, name, arguments: {} }],
            };
          },
        },
      },
    });
    await runtime.runAgent("a", { message: "go" });
    const names = runtime.agentRuns.map((run) => run.agent);
    expect(names).not.toContain("d");
    expect(names).toContain("c");
    const parent = runtime.agentRuns.find((run) => run.agent === "a");
    const child = runtime.agentRuns.find((run) => run.agent === "b");
    expect(child?.parentRunId).toBe(parent?.id);
  });

  test("fx.run of an agent with an agent tool records ask and call", async () => {
    const lookup = ai.agent("lookup", { model: "smart", tools: [] });
    const support = ai.agent("support", { model: "smart", tools: [lookup] });
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [lookup, support],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete(opts: AiCompleteOptions) {
            if (opts.tools?.[0]?.name === "lookup") {
              return {
                text: "",
                raw: {},
                model: "smart",
                driverId: "mock",
                toolCalls: [{ id: "t1", name: "lookup", arguments: {} }],
              };
            }
            return { text: "ok", raw: {}, model: "smart", driverId: "mock" };
          },
        },
      },
    });
    const { fx, ledger } = createFxContext({
      flow: "assist",
      effects: { asks: ["support"], calls: ["lookup"] },
      aiRuntime: runtime,
    });
    await fx.run(support, { message: "hi" });
    const resources = ledger.entries.map((entry) => `${entry.kind}:${entry.resource}`);
    expect(resources).toContain("ask:support");
    expect(resources).toContain("call:lookup");
  });
});
