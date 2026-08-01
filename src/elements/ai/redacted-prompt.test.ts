/**
 * Redacted values must never leak into provider-facing prompt content.
 * Same class of protection as fx.log — AI prompts are an egress vector.
 */

import { describe, expect, test } from "bun:test";
import type { AiCompleteOptions, AiModelClient } from "../../drivers/ai-types.ts";
import { REDACTED_PLACEHOLDER, Redacted } from "../../kernel/redacted.ts";
import { ai, createAiRuntime, promptContentFromInput } from "../ai.ts";

describe("Redacted never leaks into AI prompts", () => {
  test("promptContentFromInput masks nested Redacted to placeholder", () => {
    const secret = new Redacted("sk-live-super-secret");
    const content = promptContentFromInput({
      key: secret,
      nested: { token: secret },
      note: `billing with ${secret}`,
    });
    expect(content).toContain(REDACTED_PLACEHOLDER);
    expect(content).not.toContain("sk-live-super-secret");
  });

  test("ask sends placeholder to the model — never cleartext", async () => {
    const secret = new Redacted("vault-stripe-key-REAL");
    const captured: AiCompleteOptions[] = [];
    const client: AiModelClient = {
      driverId: "mock",
      model: "smart",
      async complete(opts) {
        captured.push(opts);
        return {
          text: JSON.stringify({ ok: true }),
          raw: { ok: true },
          model: "smart",
          driverId: "mock",
        };
      },
    };

    const smart = ai.model("smart");
    const prompt = smart.prompt("secure-ask", { out: { ok: "boolean" } });
    const runtime = createAiRuntime({
      models: [smart],
      prompts: [prompt],
      clients: { smart: client },
      forceJournal: false,
    });

    await runtime.ask("secure-ask", {
      apiKey: secret,
      nested: [secret],
      label: `charge ${secret}`,
    });

    expect(captured).toHaveLength(1);
    const content = captured[0]!.messages[0]!.content;
    expect(content).toContain(REDACTED_PLACEHOLDER);
    expect(content).not.toContain("vault-stripe-key-REAL");
    expect(JSON.stringify(captured[0]!.messages)).not.toContain("vault-stripe-key-REAL");
  });

  test("template-string ask input already stringified stays placeholder-only", async () => {
    const secret = new Redacted("TOP-SECRET-VALUE");
    const captured: string[] = [];
    const client: AiModelClient = {
      driverId: "mock",
      model: "smart",
      async complete(opts) {
        captured.push(opts.messages[0]!.content);
        return {
          text: "{}",
          raw: {},
          model: "smart",
          driverId: "mock",
        };
      },
    };
    const smart = ai.model("smart");
    const runtime = createAiRuntime({
      models: [smart],
      prompts: [smart.prompt("t")],
      clients: { smart: client },
      forceJournal: false,
    });

    await runtime.ask("t", `user said ${secret}`);
    expect(captured[0]).toBe(`user said ${REDACTED_PLACEHOLDER}`);
    expect(captured[0]).not.toContain("TOP-SECRET-VALUE");
  });
});
