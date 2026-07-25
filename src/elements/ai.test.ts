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
import {
  createMockAiDriver,
  memoryIndexDriver,
  mockAiDriver,
} from "../drivers/index.ts";
import { createFx } from "../kernel/fx.ts";
import {
  ai,
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
    });
    expect(triage.name).toBe("ticket-triage");
    expect(triage.version).toBe(3);
    expect(triage.model).toBe("smart");

    const agent = ai.agent("support", {
      tools: [{ name: "bookings.getBooking" }, "bookings.refundBooking"],
      maxSteps: 6,
      model: smart,
    });
    expect(agent.tools).toEqual([
      "bookings.getBooking",
      "bookings.refundBooking",
    ]);

    const embed = ai.embed("docs", {
      model: smart,
      into: { name: "kb", facet: "index" },
    });
    expect(embed.into).toBe("kb");
  });
});

describe("agent gate denial is recorded", () => {
  test("tool lacking gate is denied and denial is recorded", async () => {
    const member = gate.policy("member", ({ auth }) => !!auth.verified);
    const gates = createGateRuntime({ gates: [member] });

    const refund = ai.agent("support", {
      tools: ["bookings.refundBooking"],
      maxSteps: 2,
    });

    const called: string[] = [];
    const runtime = createAiRuntime({
      agents: [refund],
      gates,
      gatesForFlow: (name) =>
        name === "bookings.refundBooking" ? ["member"] : [],
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
      agents: [
        ai.agent("support", { tools: ["bookings.getBooking"], maxSteps: 1 }),
      ],
      gates,
      gatesForFlow: () => ["member"],
      callFlow: async () => ({ booking: "B1" }),
    });
    const result = await runtime.runAgent("support", {
      message: "status?",
      auth: { userId: "u1", scopes: new Set(), verified: true },
    });
    expect(result.ok).toBe(true);
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

describe("journaling forced · auto-cache disabled", () => {
  test("ask is journaled and replayed without re-calling the model", async () => {
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
    expect(calls).toBe(1);
    expect(runtime.journal).toHaveLength(1);
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
    const hits = await index.search(
      (await client.embed!({ input: "hello world" })).vectors[0]!,
      1,
    );
    expect(hits[0]?.id).toBe("doc-1");
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

    const out = await runtime.ask("ticket-triage", { subject: "x" }, {
      via: ["smart", "fast"],
    });
    expect(out.urgency).toBe("low");
    const entry = runtime.journal[0]!;
    expect(entry.attempts).toHaveLength(2);
    expect(entry.attempts[0]).toMatchObject({ model: "smart", ok: false });
    expect(entry.attempts[1]).toMatchObject({ model: "fast", ok: true });
    expect(entry.outcome).toBe("ok");
  });
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
    expect((thrown as AiSchemaValidationError).mismatch.missing).toContain(
      "team",
    );
    expect(runtime.journal[0]!.outcome).toBe("schema_invalid");
    expect(runtime.journal[0]!.outcome).not.toBe("provider_error");
  });
});

describe("agent tool trail carries effects; denials are not errors", () => {
  test("denied tool is a denial line with Manifest effects", async () => {
    const member = gate.policy("member", ({ auth }) => !!auth.verified);
    const gates = createGateRuntime({ gates: [member] });
    const runtime = createAiRuntime({
      agents: [
        ai.agent("support", {
          tools: ["bookings.refundBooking"],
          maxSteps: 1,
        }),
      ],
      gates,
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
