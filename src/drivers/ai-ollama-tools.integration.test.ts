/**
 * Live Ollama tool-calling through fx.ask → fx.call (capability + ledger).
 *
 * Same skip-visible convention as ai-ollama.integration.test.ts.
 */

import { describe, expect, test } from "bun:test";
import { memoryKvDriver } from "./index.ts";
import { ai, aiRateGate, createAiRuntime } from "../elements/ai.ts";
import { createGateRuntime, gate } from "../elements/gate.ts";
import { createFxContext } from "../kernel/fx.ts";
import { OLLAMA_DEFAULT_MODEL, openOllama } from "./ai-ollama.ts";

const DEFAULT_LOCAL = "http://127.0.0.1:11434";
const ENV_URL = process.env.OKE_TEST_OLLAMA_URL?.trim();

async function probeOllama(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1_500) });
    return res.ok;
  } catch {
    return false;
  }
}

const localUp = ENV_URL ? await probeOllama(ENV_URL) : await probeOllama(DEFAULT_LOCAL);
const canLive = Boolean(ENV_URL) || localUp;

if (!canLive) {
  console.log(
    "skip: live ollama tool-calling e2e (OKE_TEST_OLLAMA_URL not set; no Ollama on :11434)",
  );
}
const live = canLive ? test : test.skip;

describe("ollama live — tool-calling via fx.call", () => {
  live(
    "gated ask → real tool call → capability ledger portal entry",
    async () => {
      const url = ENV_URL || DEFAULT_LOCAL;
      const model = process.env.OKE_AI_MODEL?.trim() || OLLAMA_DEFAULT_MODEL;

      const kv = await memoryKvDriver.open({ name: "ollama-tools-rate" });
      const askRate = aiRateGate("ask");
      const gates = createGateRuntime({
        gates: [gate.public, askRate],
        kv,
        now: () => Date.now(),
      });

      // Simulate HTTP beforeHandle rate gate (AI ask preset).
      const allowed = await gates.allow([askRate.name], {
        auth: { userId: "user-1", scopes: new Set() },
        operator: { id: null },
      });
      expect(allowed).toBe(true);

      const client = await openOllama({ baseUrl: url, model });
      const smart = ai.model("smart", { provider: "ollama", model });
      const prompt = smart.prompt("tool-host");
      const runtime = createAiRuntime({
        models: [smart],
        prompts: [prompt],
        clients: { smart: client },
        forceJournal: false,
      });

      const toolInvocations: Array<{ name: string; input: unknown }> = [];
      const { fx, ledger } = createFxContext({
        flow: "assistant.chat",
        effects: {
          asks: ["tool-host"],
          calls: ["lookup.echo"],
        },
        aiRuntime: runtime,
        callHandler: async (name, input) => {
          toolInvocations.push({ name, input });
          return { ok: true, echoed: input };
        },
      });

      await fx.ask(
        prompt,
        [
          "You are a tool-using assistant.",
          'You MUST call the function lookup.echo with arguments {"text":"pong"}.',
          "Do not answer in plain text until after the tool has been called.",
        ].join(" "),
        { tools: ["lookup.echo"], maxSteps: 4 },
      );

      expect(toolInvocations.length).toBeGreaterThan(0);
      expect(toolInvocations.some((c) => c.name === "lookup.echo")).toBe(true);
      expect(ledger.entries.some((e) => e.kind === "ask" && e.resource === "tool-host")).toBe(true);
      expect(
        ledger.entries.some(
          (e) => e.kind === "call" && e.resource === "lookup.echo" && e.reversibility === "portal",
        ),
      ).toBe(true);

      await kv.close();
    },
    // Match ai-ollama.integration.test.ts — cold model load on a 6GB+ pull
    // can exceed a short CI wall clock even when the hot path is ~7s.
    25 * 60_000,
  );
});
