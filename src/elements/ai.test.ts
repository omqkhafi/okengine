/**
 * AI element acceptance:
 * - an agent calling a flow it lacks the gate for is denied and the denial is recorded
 * - a flow sending a pii field to a model fails the build
 * - nondeterministic ⇒ journaling forced, auto-cache disabled
 * - prompts as versioned artifacts with eval sets
 * - embeddings into store.index
 * - fallback chain records both model attempts
 */

import { describe, expect, test } from "bun:test";
import { createMockAiDriver, memoryIndexDriver, mockAiDriver } from "../drivers/index.ts";
import { withAbortSignal } from "../kernel/abort-scope.ts";
import { createFx } from "../kernel/fx.ts";
import { createJournal, createMemoryJournalStore } from "../kernel/journal.ts";
import {
  ai,
  AI_OBSERVABILITY_LIMIT,
  AiPiiBuildError,
  AiSchemaValidationError,
  assertAllowPiiForAsk,
  createAiRuntime,
  parseEvalJsonl,
  runPromptEvals,
} from "./ai.ts";
import { createGateRuntime, gate } from "./gate.ts";

describe("ai declaration", () => {
  test("model.prompt / agent / embed shapes", () => {
    const smart = ai.model("smart", { provider: "anthropic", tier: "opus" });
    const triage = smart.prompt("ticket-triage", {
      version: 3,
      evals: "./evals/triage.jsonl",
      budget: { maxCostPerCall: 0.02 },
      via: ["smart", "fast"],
      timeout: "30s",
    });
    expect(triage.name).toBe("ticket-triage");
    expect(triage.version).toBe(3);
    expect(triage.model).toBe("smart");
    expect(triage.via).toEqual(["smart", "fast"]);
    expect(triage.timeout).toBe("30s");

    const agent = ai.agent("support", {
      tools: [{ name: "bookings.getBooking" }, "bookings.refundBooking"],
      maxSteps: 6,
      model: smart,
    });
    expect(agent.tools).toEqual(["bookings.getBooking", "bookings.refundBooking"]);

    const embed = ai.embed("docs", {
      model: smart,
      into: { name: "kb", facet: "index" },
    });
    expect(embed.into).toBe("kb");
  });

  test("mcpServer requires allowlist and .tool() NamedRef", () => {
    const github = ai.mcpServer("github", {
      url: "https://mcp.example/github",
      tools: ["create_issue"],
    });
    expect(github.kind).toBe("mcp-server");
    expect(github.tools).toEqual(["create_issue"]);
    expect(github.tool("create_issue")).toEqual({ name: "mcp:github/create_issue" });
    expect(() => github.tool("delete_repo")).toThrow(/not in the allowlist/);
    expect(() => ai.mcpServer("broken", { url: "https://x" } as never)).toThrow(/allowlist/);
    expect(() => ai.mcpServer("both", { url: "https://x", command: "npx", tools: ["a"] })).toThrow(
      /exactly one/,
    );
  });
});

describe("agent gate denial is recorded", () => {
  test("tool lacking gate is denied and denial is recorded", async () => {
    const member = gate.policy("member", ({ auth }) => !!auth.verified);
    const gates = createGateRuntime({ gates: [member] });

    const refund = ai.agent("support", {
      tools: ["bookings.refundBooking"],
      maxSteps: 1,
      model: "smart",
    });

    const called: string[] = [];
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [refund],
      gates,
      defaultDriver: createMockAiDriver({
        "*": {
          __toolCalls: [
            { id: "c1", name: "bookings.refundBooking", arguments: { reason: "customer" } },
          ],
        },
      }),
      gatesForFlow: (name) => (name === "bookings.refundBooking" ? ["member"] : []),
      callFlow: async (name) => {
        called.push(name);
        return { ok: true };
      },
    });

    const result = await runtime.runAgent("support", {
      message: "refund please",
      auth: { userId: "u1", scopes: new Set(), verified: false },
    });

    expect(result.ok).toBe(false);
    expect(result.denials).toHaveLength(1);
    expect(result.denials[0]!.tool).toBe("bookings.refundBooking");
    expect(result.denials[0]!.gate).toBe("member");
    expect(runtime.denials).toHaveLength(1);
    expect(called).toHaveLength(0);
  });

  test("tool with satisfied gate is called", async () => {
    const member = gate.policy("member", ({ auth }) => !!auth.verified);
    const gates = createGateRuntime({ gates: [member] });
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [
        ai.agent("support", { tools: ["bookings.getBooking"], maxSteps: 1, model: "smart" }),
      ],
      gates,
      defaultDriver: createMockAiDriver({
        "*": {
          __toolCalls: [{ id: "c1", name: "bookings.getBooking", arguments: {} }],
        },
      }),
      gatesForFlow: () => ["member"],
      callFlow: async () => ({ booking: "B1" }),
    });
    const result = await runtime.runAgent("support", {
      message: "status?",
      auth: { userId: "u1", scopes: new Set(), verified: true },
    });
    expect(result.stopReason).toBe("max_steps");
    expect(result.ok).toBe(false);
    expect(result.denials).toHaveLength(0);
    expect(result.output).toEqual({ booking: "B1" });
  });
});

describe("pii to third-party model fails the build", () => {
  test("pii field without allowPii throws AiPiiBuildError", () => {
    expect(() =>
      assertAllowPiiForAsk({
        flow: "support.createTicket",
        askFields: ["subject", "email", "body"],
        classifications: {
          "users.email": { pii: true },
          email: { pii: true },
        },
        provider: "anthropic",
        pii: "masked",
      }),
    ).toThrow(AiPiiBuildError);

    try {
      assertAllowPiiForAsk({
        flow: "support.createTicket",
        askFields: ["email"],
        classifications: { email: { pii: true } },
        provider: "openai-compatible",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(AiPiiBuildError);
      expect((err as AiPiiBuildError).fields).toContain("email");
      expect((err as AiPiiBuildError).message).toContain("allowPii");
    }
  });

  test("allowPii or mock provider permits", () => {
    expect(() =>
      assertAllowPiiForAsk({
        flow: "support.createTicket",
        askFields: ["email"],
        classifications: { email: { pii: true } },
        provider: "anthropic",
        allowPii: true,
      }),
    ).not.toThrow();

    expect(() =>
      assertAllowPiiForAsk({
        flow: "support.createTicket",
        askFields: ["email"],
        classifications: { email: { pii: true } },
        provider: "mock",
      }),
    ).not.toThrow();
  });
});

describe("agent maxCostPerRun", () => {
  test("a model call over the cap is the last call and the run resolves", async () => {
    let calls = 0;
    const agent = ai.agent("budget-agent", {
      model: "smart",
      tools: ["orders.get"],
      maxSteps: 4,
      budget: { maxCostPerRun: 0.5 },
    });
    const called: string[] = [];
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [agent],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete() {
            calls++;
            return {
              text: "",
              raw: {},
              model: "smart",
              driverId: "mock",
              usage: { cost: 0.8 },
              toolCalls: [{ id: "c1", name: "orders.get", arguments: {} }],
            };
          },
        },
      },
      callFlow: async (name) => {
        called.push(name);
        return { ok: true };
      },
    });
    const result = await runtime.runAgent("budget-agent", { message: "look up" });
    expect(calls).toBe(1);
    expect(called).toEqual([]);
    expect(result.ok).toBe(false);
    expect(result.stopReason).toBe("budget");
    expect(result.cost).toBe(0.8);
  });

  test("tools run while under the cap, and the loop stops once a later call crosses it", async () => {
    let calls = 0;
    const agent = ai.agent("budget-round", {
      model: "smart",
      tools: ["orders.get"],
      maxSteps: 4,
      budget: { maxCostPerRun: 0.5 },
    });
    const called: string[] = [];
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [agent],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete() {
            calls++;
            return {
              text: calls === 1 ? "" : "done",
              raw: {},
              model: "smart",
              driverId: "mock",
              usage: { cost: calls === 1 ? 0.4 : 0.4 },
              ...(calls === 1
                ? { toolCalls: [{ id: "c1", name: "orders.get", arguments: {} }] }
                : {}),
            };
          },
        },
      },
      callFlow: async (name) => {
        called.push(name);
        return { ok: true };
      },
    });
    const result = await runtime.runAgent("budget-round", { message: "look up" });
    expect(called).toEqual(["orders.get"]);
    expect(calls).toBe(2);
    expect(result.ok).toBe(false);
    expect(result.stopReason).toBe("budget");
    expect(result.cost).toBeCloseTo(0.8);
  });

  test("maxSteps is not a normal completion", async () => {
    const agent = ai.agent("step-cap", {
      model: "smart",
      tools: ["orders.get"],
      maxSteps: 1,
    });
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [agent],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete() {
            return {
              text: "",
              raw: {},
              model: "smart",
              driverId: "mock",
              toolCalls: [{ id: "c1", name: "orders.get", arguments: {} }],
            };
          },
        },
      },
      callFlow: async () => ({ ok: true }),
    });
    const result = await runtime.runAgent("step-cap", { message: "go" });
    expect(result.ok).toBe(false);
    expect(result.stopReason).toBe("max_steps");
    expect(result.steps).toBe(1);
  });

  test("a denial fed back to the model does not terminate as denied", async () => {
    let calls = 0;
    const member = gate.policy("member", () => false);
    const agent = ai.agent("deny-continue", {
      model: "smart",
      tools: ["orders.refund"],
      maxSteps: 2,
    });
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [agent],
      gates: createGateRuntime({ gates: [member] }),
      gatesForFlow: () => ["member"],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete() {
            calls++;
            if (calls === 1) {
              return {
                text: "",
                raw: {},
                model: "smart",
                driverId: "mock",
                toolCalls: [{ id: "c1", name: "orders.refund", arguments: {} }],
              };
            }
            return { text: "done", raw: { done: true }, model: "smart", driverId: "mock" };
          },
        },
      },
      callFlow: async () => ({ ok: true }),
    });
    const result = await runtime.runAgent("deny-continue", {
      message: "refund",
      auth: { userId: "u1", scopes: new Set(), verified: false },
    });
    expect(calls).toBe(2);
    expect(result.stopReason).toBe("completed");
    expect(result.denials).toHaveLength(1);
    expect(result.ok).toBe(false);
  });

  test("an unknown tool terminates the run as denied", async () => {
    const agent = ai.agent("unknown-tool", {
      model: "smart",
      tools: ["orders.get"],
      maxSteps: 2,
    });
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [agent],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete() {
            return {
              text: "",
              raw: {},
              model: "smart",
              driverId: "mock",
              toolCalls: [{ id: "c1", name: "nope", arguments: {} }],
            };
          },
        },
      },
      callFlow: async () => ({ ok: true }),
    });
    const result = await runtime.runAgent("unknown-tool", { message: "go" });
    expect(result.stopReason).toBe("denied");
    expect(result.ok).toBe(false);
    expect(runtime.agentRuns[0]?.stopReason).toBe("denied");
  });

  test("an aborted run is recorded and then rejected", async () => {
    const agent = ai.agent("abort-agent", { model: "smart", tools: [], maxSteps: 2 });
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [agent],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete() {
            return { text: "ok", raw: {}, model: "smart", driverId: "mock" };
          },
        },
      },
    });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      withAbortSignal(ctrl.signal, () => runtime.runAgent("abort-agent", { message: "go" })),
    ).rejects.toThrow(/aborted/);
    expect(runtime.agentRuns[0]?.stopReason).toBe("aborted");
  });
});

describe("journaling forced · auto-cache disabled", () => {
  test("identical asks both reach the model and both are journaled", async () => {
    let calls = 0;
    const driver = createMockAiDriver({
      "*": { urgency: "high", team: "ops" },
    });
    // Wrap to count
    const base = await driver.open({ model: "mock" });
    const counting = {
      ...base,
      async complete(opts: Parameters<typeof base.complete>[0]) {
        calls++;
        return base.complete(opts);
      },
    };

    const smart = ai.model("smart", { provider: "mock" });
    const triage = smart.prompt("ticket-triage", { version: 1 });
    const runtime = createAiRuntime({
      models: [smart],
      prompts: [triage],
      clients: { smart: counting },
    });

    expect(runtime.journalingForced).toBe(true);
    expect(runtime.autoCacheDisabled).toBe(true);

    const a = await runtime.ask("ticket-triage", { subject: "x" });
    const b = await runtime.ask("ticket-triage", { subject: "x" });
    expect(a).toEqual(b);
    expect(calls).toBe(2);
    expect(runtime.journal).toHaveLength(2);
  });

  test("ask journal and agent runs keep only the newest observability rows", async () => {
    const smart = ai.model("ring-smart", { provider: "mock" });
    const prompt = smart.prompt("ring-prompt", { version: 1 });
    const runtime = createAiRuntime({
      models: [smart],
      prompts: [prompt],
      agents: [
        ai.agent("ring-agent", {
          model: "ring-smart",
          tools: [],
          maxSteps: 1,
        }),
      ],
      defaultDriver: createMockAiDriver({
        "*": { ok: true },
      }),
    });

    for (let i = 0; i < AI_OBSERVABILITY_LIMIT + 1; i++) {
      await runtime.ask("ring-prompt", { n: i });
      await runtime.runAgent("ring-agent", { message: `m-${i}` });
    }
    expect(runtime.journal).toHaveLength(AI_OBSERVABILITY_LIMIT);
    expect(runtime.agentRuns).toHaveLength(AI_OBSERVABILITY_LIMIT);
    expect(runtime.journal[0]?.input).toEqual({ n: 1 });
    expect(runtime.journal.at(-1)?.input).toEqual({ n: AI_OBSERVABILITY_LIMIT });
    expect(runtime.agentRuns[0]?.message).toBe("m-1");
    expect(runtime.agentRuns.at(-1)?.message).toBe(`m-${AI_OBSERVABILITY_LIMIT}`);
  });

  test("a durable journal replays fx.ask without a second model call", async () => {
    let calls = 0;
    const driver = createMockAiDriver({
      "*": { urgency: "high" },
    });
    const base = await driver.open({ model: "mock" });
    const counting = {
      ...base,
      async complete(opts: Parameters<typeof base.complete>[0]) {
        calls++;
        return base.complete(opts);
      },
    };
    const smart = ai.model("durable-smart", { provider: "mock" });
    const triage = smart.prompt("durable-triage", { version: 1 });
    const runtime = createAiRuntime({
      models: [smart],
      prompts: [triage],
      clients: { "durable-smart": counting },
    });
    const journal = createJournal({ store: createMemoryJournalStore() });
    const session = await journal.start("support.triage", { subject: "x" });
    const fx = createFx({
      flow: "support.triage",
      effects: { asks: ["durable-triage"] },
      aiRuntime: runtime,
      journal: session,
    });
    const first = await fx.ask("durable-triage", { subject: "x" });
    expect(calls).toBe(1);

    const resumed = await journal.resume(session.runId);
    const again = createFx({
      flow: "support.triage",
      effects: { asks: ["durable-triage"] },
      aiRuntime: runtime,
      journal: resumed,
    });
    const second = await again.ask("durable-triage", { subject: "x" });
    expect(calls).toBe(1);
    expect(second).toEqual(first);
  });

  test("fx.cache is disabled when aiRuntime is bound", async () => {
    const smart = ai.model("smart", { provider: "mock" });
    const client = await mockAiDriver.open({ model: "mock" });
    const aiRuntime = createAiRuntime({
      models: [smart],
      clients: { smart: client },
    });
    const fx = createFx({
      flow: "support.createTicket",
      effects: {},
      aiRuntime,
    });
    await fx.cache.set("k", "v");
    expect(await fx.cache.get("k")).toBeUndefined();
    const produced = await fx.cache.getOrSet("k", "1m", () => "fresh");
    expect(produced).toBe("fresh");
    expect(await fx.cache.get("k")).toBeUndefined();
  });
});

describe("prompt evals gate CI", () => {
  test("runPromptEvals fails on mismatch", async () => {
    const smart = ai.model("smart", { provider: "mock" });
    const triage = smart.prompt("ticket-triage", { version: 3 });
    const client = await createMockAiDriver({
      "*": { urgency: "high", team: "ops", summary: "ok" },
    }).open();
    const runtime = createAiRuntime({
      models: [smart],
      prompts: [triage],
      clients: { smart: client },
    });

    const cases = parseEvalJsonl(
      [
        JSON.stringify({
          id: "1",
          input: { subject: "x" },
          expect: { urgency: "high", team: "ops", summary: "ok" },
        }),
        JSON.stringify({
          id: "2",
          input: { subject: "y" },
          expect: { urgency: "low" },
        }),
      ].join("\n"),
    );

    const suite = await runPromptEvals({
      prompt: "ticket-triage",
      version: 3,
      cases,
      ask: (input) => runtime.ask("ticket-triage", input),
    });
    expect(suite.ok).toBe(false);
    expect(suite.failed).toBe(1);
    expect(suite.passed).toBe(1);
  });
});

describe("embeddings into store.index", () => {
  test("embed upserts into index driver", async () => {
    const index = await memoryIndexDriver.open({ name: "kb", dims: 8 });
    const smart = ai.model("smart", { provider: "mock" });
    const embed = ai.embed("docs", { model: smart, into: "kb" });
    const client = await mockAiDriver.open({ model: "mock" });
    const runtime = createAiRuntime({
      models: [smart],
      embeds: [embed],
      clients: { smart: client },
      indexes: { kb: index },
    });
    await runtime.embed("docs", "doc-1", "hello world");
    const hits = await index.search((await client.embed!({ input: "hello world" })).vectors[0]!, 1);
    expect(hits[0]?.id).toBe("doc-1");
  });

  test("embed into a meilisearch (full-text) index fails loud", async () => {
    const smart = ai.model("smart", { provider: "mock" });
    const embed = ai.embed("docs", { model: smart, into: "kb" });
    const client = await mockAiDriver.open({ model: "mock" });
    const textIndex = {
      driverId: "meilisearch" as const,
      upsert: async () => {},
      search: async () => ({ hits: [] }),
      delete: async () => true,
      close: async () => {},
    };
    const runtime = createAiRuntime({
      models: [smart],
      embeds: [embed],
      clients: { smart: client },
      indexes: { kb: textIndex as never },
    });
    await expect(runtime.embed("docs", "doc-1", "hello world")).rejects.toThrow(
      /needs a vector index/,
    );
  });
});

describe("model fallback chain", () => {
  test("records both attempts when first model fails", async () => {
    const failing = {
      driverId: "mock" as const,
      model: "smart",
      async complete() {
        throw new Error("smart down");
      },
    };
    const ok = await createMockAiDriver({
      "*": { urgency: "low" },
    }).open({ model: "fast" });

    const smart = ai.model("smart", { provider: "mock" });
    const fast = ai.model("fast", { provider: "mock" });
    const triage = smart.prompt("ticket-triage", { version: 1 });
    const runtime = createAiRuntime({
      models: [smart, fast],
      prompts: [triage],
      clients: { smart: failing, fast: ok },
    });

    const out = await runtime.ask(
      "ticket-triage",
      { subject: "x" },
      {
        via: ["smart", "fast"],
      },
    );
    expect(out.urgency).toBe("low");
    expect(out.via).toBe("fast");
    const entry = runtime.journal[0]!;
    // Same-model retry (1) + second model success.
    expect(entry.attempts.length).toBeGreaterThanOrEqual(2);
    expect(entry.attempts[0]).toMatchObject({ model: "smart", ok: false });
    expect(entry.attempts.at(-1)).toMatchObject({ model: "fast", ok: true });
    expect(entry.outcome).toBe("ok");
  });

  test("prompt.via is used when ask omits via", async () => {
    const failing = {
      driverId: "mock" as const,
      model: "smart",
      async complete() {
        throw new Error("smart down");
      },
    };
    const ok = await createMockAiDriver({
      "*": { summary: "ok" },
    }).open({ model: "local" });
    const smart = ai.model("smart", { provider: "mock" });
    const local = ai.model("local", { provider: "mock" });
    const summarize = smart.prompt("summarize-note", {
      via: ["smart", "local"],
      timeout: "30s",
    });
    const runtime = createAiRuntime({
      models: [smart, local],
      prompts: [summarize],
      clients: { smart: failing, local: ok },
    });
    const out = await runtime.ask("summarize-note", { body: "x" });
    expect(out.summary).toBe("ok");
    expect(out.via).toBe("local");
  });

  test("permanent 401 does not advance via", async () => {
    const unauthorized = {
      driverId: "mock" as const,
      model: "smart",
      async complete() {
        const err = new Error("openai-compatible HTTP 401") as Error & { status: number };
        err.status = 401;
        throw err;
      },
    };
    let localCalls = 0;
    const local = {
      driverId: "mock" as const,
      model: "local",
      async complete() {
        localCalls++;
        return { text: "{}", raw: { summary: "nope" }, model: "local", driverId: "mock" as const };
      },
    };
    const smart = ai.model("smart", { provider: "mock" });
    const localModel = ai.model("local", { provider: "mock" });
    const prompt = smart.prompt("summarize-note", { via: ["smart", "local"] });
    const runtime = createAiRuntime({
      models: [smart, localModel],
      prompts: [prompt],
      clients: { smart: unauthorized, local },
    });
    await expect(runtime.ask("summarize-note", {})).rejects.toThrow(/401/);
    expect(localCalls).toBe(0);
  });

  test("timeout aborts a hanging complete", async () => {
    const hanging = {
      driverId: "mock" as const,
      model: "smart",
      async complete(opts: { signal?: AbortSignal }) {
        const signal = opts.signal;
        if (!signal) throw new Error("expected abort signal");
        await new Promise<void>((_resolve, reject) => {
          const onAbort = () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          };
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
        });
        return { text: "late", raw: { text: "late" }, model: "smart", driverId: "mock" as const };
      },
    };
    const smart = ai.model("smart", { provider: "mock" });
    const prompt = smart.prompt("hang", { timeout: 40 });
    const runtime = createAiRuntime({
      models: [smart],
      prompts: [prompt],
      clients: { smart: hanging },
      forceJournal: false,
    });
    await expect(runtime.ask("hang", {})).rejects.toThrow();
  }, 2_000);
});

describe("schema-validation is its own class", () => {
  test("model answered but shape wrong → AiSchemaValidationError", async () => {
    const smart = ai.model("smart", { provider: "mock" });
    const triage = smart.prompt("ticket-triage", {
      version: 3,
      out: {
        type: "object",
        properties: {
          urgency: { type: "string" },
          team: { type: "string" },
        },
        required: ["urgency", "team"],
      },
    });
    const client = await createMockAiDriver({
      "*": { urgency: "high" },
    }).open();
    const runtime = createAiRuntime({
      models: [smart],
      prompts: [triage],
      clients: { smart: client },
    });

    let thrown: unknown;
    try {
      await runtime.ask("ticket-triage", { subject: "x" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AiSchemaValidationError);
    expect((thrown as AiSchemaValidationError).code).toBe("AiSchemaInvalid");
    expect((thrown as AiSchemaValidationError).mismatch.missing).toContain("team");
    expect(runtime.journal[0]!.outcome).toBe("schema_invalid");
    expect(runtime.journal[0]!.outcome).not.toBe("provider_error");
  });
});

describe("agent tool trail carries effects; denials are not errors", () => {
  test("denied tool is a denial line with Manifest effects", async () => {
    const member = gate.policy("member", ({ auth }) => !!auth.verified);
    const gates = createGateRuntime({ gates: [member] });
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [
        ai.agent("support", {
          tools: ["bookings.refundBooking"],
          maxSteps: 1,
          model: "smart",
        }),
      ],
      gates,
      defaultDriver: createMockAiDriver({
        "*": {
          __toolCalls: [{ id: "c1", name: "bookings.refundBooking", arguments: {} }],
        },
      }),
      gatesForFlow: () => ["member"],
      effectsForFlow: (name) =>
        name === "bookings.refundBooking"
          ? [
              { kind: "write", resource: "sql:bookings" },
              { kind: "send", resource: "refund-notice" },
            ]
          : [],
      callFlow: async () => ({ ok: true }),
    });

    const result = await runtime.runAgent("support", {
      message: "refund",
      auth: { userId: "u1", scopes: new Set(), verified: false },
    });

    expect(result.ok).toBe(false);
    expect(result.trail).toHaveLength(1);
    expect(result.trail[0]!.status).toBe("denied");
    expect(result.trail[0]!.denial?.gate).toBe("member");
    expect(result.trail[0]!.effects).toEqual([
      { kind: "write", resource: "sql:bookings" },
      { kind: "send", resource: "refund-notice" },
    ]);
    expect(runtime.agentRuns).toHaveLength(1);
    expect(runtime.denials).toHaveLength(1);
  });
});

describe("ask journal tokens", () => {
  test("mock driver tokens reach the journal", async () => {
    const smart = ai.model("smart", { provider: "mock" });
    const triage = smart.prompt("ticket-triage", { version: 1 });
    const client = await mockAiDriver.open({
      model: "mock",
      mockResponses: { "*": { urgency: "high" } },
    });
    const runtime = createAiRuntime({
      models: [smart],
      prompts: [triage],
      clients: { smart: client },
    });

    await runtime.ask("ticket-triage", { subject: "hello" });
    expect(runtime.journal).toHaveLength(1);
    const entry = runtime.journal[0]!;
    expect(entry.inputTokens).toBeGreaterThan(0);
    expect(entry.outputTokens).toBeGreaterThan(0);
    expect(entry.cost).toBe(0);
  });

  test("token-only complete result journals tokens and omits invented cost", async () => {
    const smart = ai.model("smart", { provider: "openai-compatible" });
    const triage = smart.prompt("ticket-triage", { version: 2 });
    const runtime = createAiRuntime({
      models: [smart],
      prompts: [triage],
      clients: {
        smart: {
          driverId: "openai-compatible",
          model: "gpt-test",
          async complete() {
            return {
              text: JSON.stringify({ ok: true }),
              raw: { ok: true },
              model: "gpt-test",
              driverId: "openai-compatible",
              usage: { inputTokens: 12, outputTokens: 7 },
            };
          },
        },
      },
    });

    await runtime.ask("ticket-triage", { subject: "x" });
    const entry = runtime.journal[0]!;
    expect(entry.inputTokens).toBe(12);
    expect(entry.outputTokens).toBe(7);
    expect(entry.cost).toBe(0);
  });
});

describe("ask budget and cancel", () => {
  test("maxCostPerCall stops a successful over-budget ask", async () => {
    const smart = ai.model("smart", { provider: "mock" });
    const prompt = smart.prompt("pricey", { budget: { maxCostPerCall: 0.01 } });
    const runtime = createAiRuntime({
      models: [smart],
      prompts: [prompt],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete() {
            return {
              text: "{}",
              raw: {},
              model: "smart",
              driverId: "mock",
              usage: { cost: 0.5 },
            };
          },
        },
      },
    });
    await expect(runtime.ask("pricey", {})).rejects.toThrow(/maxCostPerCall/);
    expect(runtime.journal[0]!.outcome).toBe("budget_exceeded");
  });

  test("disconnect AbortError does not advance via", async () => {
    let localCalls = 0;
    const smart = ai.model("smart", { provider: "mock" });
    const local = ai.model("local", { provider: "mock" });
    const prompt = smart.prompt("cancel-me", { via: ["smart", "local"] });
    const runtime = createAiRuntime({
      models: [smart, local],
      prompts: [prompt],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete() {
            const err = new Error("aborted");
            err.name = "AbortError";
            throw err;
          },
        },
        local: {
          driverId: "mock",
          model: "local",
          async complete() {
            localCalls++;
            return { text: "{}", raw: {}, model: "local", driverId: "mock" };
          },
        },
      },
    });
    await expect(runtime.ask("cancel-me", {})).rejects.toThrow(/aborted/);
    expect(localCalls).toBe(0);
  });

  test("driverId opens the matching protocol driver", async () => {
    let opened = "";
    const local = ai.model("local", { driverId: "openai-compatible", model: "llama" });
    const prompt = local.prompt("ping");
    const runtime = createAiRuntime({
      models: [local],
      prompts: [prompt],
      drivers: {
        "openai-compatible": {
          id: "openai-compatible",
          async open() {
            opened = "openai-compatible";
            return {
              driverId: "openai-compatible",
              model: "llama",
              async complete() {
                return { text: "{}", raw: {}, model: "llama", driverId: "openai-compatible" };
              },
            };
          },
        },
      },
    });
    await runtime.ask("ping", {});
    expect(opened).toBe("openai-compatible");
  });
});

describe("stream via", () => {
  test("advances to the next model when the first stream fails before a chunk", async () => {
    const smart = ai.model("smart");
    const local = ai.model("local");
    const runtime = createAiRuntime({
      models: [smart, local],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete() {
            return { text: "", model: "smart", driverId: "mock" };
          },
          async *stream() {
            throw new Error("smart stream down");
          },
        },
        local: {
          driverId: "mock",
          model: "local",
          async complete() {
            return { text: "", model: "local", driverId: "mock" };
          },
          async *stream() {
            yield { text: "ok" };
          },
        },
      },
    });
    const parts: string[] = [];
    for await (const c of runtime.stream("smart", { prompt: "hi", via: ["local"] })) {
      parts.push(c);
    }
    expect(parts.join("")).toBe("ok");
  });
});
