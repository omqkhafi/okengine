/**
 * Console AI projection tests (console §9.10).
 */

import { describe, expect, test } from "bun:test";
import { ai, createAiRuntime, runPromptEvals } from "../../elements/ai.ts";
import { createMockAiDriver } from "../../drivers/ai-mock.ts";
import { createGateRuntime, gate } from "../../elements/gate.ts";
import type { Manifest } from "../../manifest/types.ts";
import {
  effectsForFlowFromManifest,
  projectAiPanel,
  projectAllowPii,
} from "./ai.ts";

const manifest = {
  oke: "1.0",
  name: "skyport",
  flows: {
    "support.createTicket": {
      allowPii: true,
      pii: "allow",
      source: "src/flows/support/index.ts",
      effects: {
        asks: ["ticket-triage"],
        writes: ["sql:tickets"],
      },
    },
    "bookings.refundBooking": {
      effects: {
        writes: ["sql:bookings"],
        sends: ["refund-notice"],
      },
    },
  },
  ai: {
    prompts: {
      "ticket-triage": {
        version: 3,
        model: "smart",
        budget: { maxCostPerCall: 0.02 },
        evals: "./evals/triage.jsonl",
      },
    },
    agents: {
      support: {
        tools: ["bookings.getBooking", "bookings.refundBooking"],
        maxSteps: 6,
      },
    },
  },
} as unknown as Manifest;

describe("projectAiPanel", () => {
  test("surfaces allowPii standing table from Manifest", () => {
    const rows = projectAllowPii(manifest);
    expect(rows.some((r) => r.flowId === "support.createTicket" && r.allowPii)).toBe(
      true,
    );
  });

  test("effectsForFlowFromManifest matches trail vocabulary", () => {
    expect(effectsForFlowFromManifest(manifest, "bookings.refundBooking")).toEqual([
      { kind: "write", resource: "sql:bookings" },
      { kind: "send", resource: "refund-notice" },
    ]);
  });

  test("distributions + schema class + denial trail from AiRuntime", async () => {
    const smart = ai.model("smart", { provider: "mock" });
    const triage = smart.prompt("ticket-triage", {
      version: 3,
      budget: { maxCostPerCall: 0.02 },
      out: {
        type: "object",
        properties: {
          urgency: { type: "string" },
          team: { type: "string" },
        },
        required: ["urgency", "team"],
      },
    });
    const okClient = await createMockAiDriver({
      "*": { urgency: "high", team: "ops" },
    }).open();
    const badClient = await createMockAiDriver({
      "*": { urgency: "high" },
    }).open();

    const member = gate.policy("member", ({ auth }) => !!auth.verified);
    const gates = createGateRuntime({ gates: [member] });

    const runtime = createAiRuntime({
      models: [smart],
      prompts: [triage],
      agents: [
        ai.agent("support", {
          tools: ["bookings.refundBooking"],
          maxSteps: 1,
        }),
      ],
      clients: { smart: okClient },
      gates,
      gatesForFlow: () => ["member"],
      effectsForFlow: (name) => effectsForFlowFromManifest(manifest, name),
      callFlow: async () => ({ ok: true }),
    });

    await runtime.ask("ticket-triage", { subject: "a" });
    // Force a schema-invalid sample with a temporary client swap via second runtime
    const badRuntime = createAiRuntime({
      models: [smart],
      prompts: [triage],
      clients: { smart: badClient },
    });
    try {
      await badRuntime.ask("ticket-triage", { subject: "b" });
    } catch {
      // expected
    }

    await runtime.runAgent("support", {
      message: "refund",
      auth: { userId: "u1", scopes: new Set(), verified: false },
    });

    const evals = await runPromptEvals({
      prompt: "ticket-triage",
      version: 3,
      cases: [
        {
          id: "1",
          input: { subject: "a" },
          expect: { urgency: "high", team: "ops" },
        },
      ],
      ask: (input) => runtime.ask("ticket-triage", input),
    });

    // Merge journals: project from a runtime that has the ok ask + agent run,
    // and inject schema-invalid via combining — use badRuntime journal by
    // projecting twice is awkward; instead project with runtime that includes
    // both journals manually is not possible. Project badRuntime separately
    // and assert schema class there; assert trail on main projection.
    const okProj = projectAiPanel({
      manifest,
      aiRuntime: runtime,
      evalResults: [evals],
    });
    expect(okProj.prompts[0]!.manifestDiffPath).toBe(
      "/ai/prompts/ticket-triage/version",
    );
    expect(okProj.versions[0]!.evalScore.samples.length).toBeGreaterThan(0);
    expect(okProj.agentRuns[0]!.trail[0]!.status).toBe("denied");
    expect(okProj.agentRuns[0]!.trail[0]!.denial?.gate).toBe("member");
    expect(okProj.agentRuns[0]!.trail[0]!.effects).toEqual([
      { kind: "write", resource: "sql:bookings" },
      { kind: "send", resource: "refund-notice" },
    ]);
    expect(okProj.denials).toHaveLength(1);

    const badProj = projectAiPanel({
      manifest,
      aiRuntime: badRuntime,
    });
    const v = badProj.versions.find((x) => x.prompt === "ticket-triage");
    expect(v).toBeDefined();
    expect(v!.outcomeCounts.schema_invalid).toBeGreaterThan(0);
    expect(v!.schemaInvalidRate).toBeGreaterThan(0);
    expect(v!.providerErrorRate).toBe(0);
  });
});
