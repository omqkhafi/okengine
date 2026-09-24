/**
 * Park one durable agent tool approval so the seeded Console can approve it.
 *
 * The follow log stays on this app. Console forwards `GET /agent/runs/:runId/events`
 * here and wakes the run after the operator resolves the approval.
 */

import { flow, type AnyFlowDef } from "../../kernel/flow.ts";
import { createMemoryJournalStore, type JournalStore } from "../../kernel/journal.ts";
import { oke, type OkeApp } from "../../kernel/app.ts";
import type { Binding } from "../../kernel/on.ts";
import { http } from "../../kernel/triggers.ts";
import { ai, createAiRuntime } from "../../elements/ai.ts";
import { createGateRuntime, gate } from "../../elements/gate.ts";
import { getAgentEventLog, type AgentEventLog } from "../../elements/ai/run-events.ts";

/** A parked approval the Console queue and follow view can drive. */
export interface ParkedApproval {
  readonly store: JournalStore;
  readonly app: OkeApp;
  readonly log: AgentEventLog | undefined;
  /** Resume the durable run after the Console writes the approval. */
  resume(): Promise<void>;
  stop(): Promise<void>;
  /** Proxy the follow route without the Console session. */
  fetch(request: Request): Promise<Response>;
}

/**
 * Boot a tiny app, start one agent run, and leave it sleeping on a tool approval.
 */
export async function bootParkedApproval(): Promise<ParkedApproval> {
  const store = createMemoryJournalStore();
  const ops = gate.policy("ops", () => true);
  const runtime = createAiRuntime({
    journalStore: store,
    models: [ai.model("smart")],
    gates: createGateRuntime({ gates: [ops] }),
    agents: [
      ai.agent("support", {
        model: "smart",
        maxSteps: 4,
        tools: [{ name: "refund", approval: true, gate: "ops", timeout: "1h" }],
      }),
    ],
    clients: {
      smart: {
        driverId: "mock",
        model: "smart",
        async complete(opts) {
          if (opts.messages.some((message) => message.role === "tool")) {
            return {
              text: "Refunded.",
              raw: {},
              model: "smart",
              driverId: "mock",
              usage: { inputTokens: 3, outputTokens: 2, cost: 0 },
            };
          }
          return {
            text: "",
            raw: {},
            model: "smart",
            driverId: "mock",
            toolCalls: [{ id: "tc1", name: "refund", arguments: { amount: 10 } }],
          };
        },
      },
    },
  });
  const refund = flow("refund", {
    do: async (input: { amount?: number }) => ({ refunded: true, amount: input.amount ?? 0 }),
  });
  const assist: Binding = {
    trigger: http.post("/assist"),
    flow: flow("assist", {
      durable: true,
      effects: { asks: ["support"], calls: ["refund"] },
      do: (_input, fx) =>
        fx.json.stream(fx.run("support", { message: "refund" }, { stream: true })),
    }) as AnyFlowDef,
  };
  const app = oke({
    name: "console-seed-approval",
    env: "test",
    startScheduler: false,
    registry: "ignore",
    gate: { unguardedHttp: "allow", policies: [ops] },
    bindings: [assist, { trigger: http.post("/refund").public(), flow: refund as AnyFlowDef }],
    elements: {
      journal: { store, instanceId: "console-seed-approval", leaseMs: 30_000, driverId: "memory" },
      ai: runtime,
    },
  });
  await app.boot({ env: "test" });
  const parked = await app.fetch(
    new Request("http://localhost/assist", { method: "POST", body: "{}" }),
  );
  if (parked.status >= 500) {
    throw new Error(`seeded approval failed to park (${parked.status})`);
  }
  await parked.text();
  const log = getAgentEventLog();
  return {
    store,
    app,
    log,
    async resume() {
      await app.resumeDurable(Date.now() + 1000);
    },
    async stop() {
      await app.stop();
    },
    fetch(request) {
      const headers = new Headers(request.headers);
      headers.delete("authorization");
      headers.delete("cookie");
      return app.fetch(
        new Request(request.url, {
          method: request.method,
          headers,
        }),
      );
    },
  };
}
