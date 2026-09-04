/**
 * OpenAI-compatible provider registry — resolve / override / unknown / limited.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { openaiCompatibleAiDriver } from "../../drivers/ai-openai-compatible.ts";
import { extractFromSources } from "../../compiler/extract.ts";
import {
  ai,
  createAiRuntime,
  formatAiProviderTier2Warn,
  getAiProviderEntry,
  resolveAiModelBaseUrl,
  resetAiDecls,
} from "../ai.ts";

afterEach(() => {
  resetAiDecls();
});

describe("resolveAiModelBaseUrl", () => {
  test("known provider omits baseUrl → registry URL", () => {
    expect(resolveAiModelBaseUrl({ provider: "openrouter" })).toEqual({
      baseUrl: "https://openrouter.ai/api/v1",
    });
    expect(resolveAiModelBaseUrl({ provider: "groq" }).baseUrl).toBe(
      "https://api.groq.com/openai/v1",
    );
    expect(resolveAiModelBaseUrl({ provider: "together" }).baseUrl).toBe(
      "https://api.together.ai/v1",
    );
    expect(resolveAiModelBaseUrl({ provider: "deepinfra" }).baseUrl).toBe(
      "https://api.deepinfra.com/v1/openai",
    );
    expect(resolveAiModelBaseUrl({ provider: "deepseek" }).baseUrl).toBe(
      "https://api.deepseek.com",
    );
    expect(resolveAiModelBaseUrl({ provider: "vercel" }).baseUrl).toBe(
      "https://ai-gateway.vercel.sh/v1",
    );
  });

  test("explicit baseUrl always wins for a known provider", () => {
    expect(
      resolveAiModelBaseUrl({
        provider: "openrouter",
        baseUrl: "https://proxy.example/v1",
      }),
    ).toEqual({ baseUrl: "https://proxy.example/v1" });
  });

  test("unknown provider without baseUrl fails loud", () => {
    expect(() => resolveAiModelBaseUrl({ provider: "cloudflare" })).toThrow(
      /unknown provider "cloudflare" requires an explicit baseUrl/,
    );
    expect(() => resolveAiModelBaseUrl({ provider: "not-a-real-provider" })).toThrow(
      /unknown provider "not-a-real-provider"/,
    );
  });

  test("unknown provider with explicit baseUrl is allowed", () => {
    expect(
      resolveAiModelBaseUrl({
        provider: "cloudflare",
        baseUrl: "https://api.cloudflare.com/client/v4/accounts/abc/ai/v1",
      }),
    ).toEqual({
      baseUrl: "https://api.cloudflare.com/client/v4/accounts/abc/ai/v1",
    });
  });

  test("native driverId skips openai-compat registry for anthropic", () => {
    expect(
      resolveAiModelBaseUrl({
        provider: "anthropic",
        driverId: "anthropic",
      }),
    ).toEqual({});
  });

  test("limited anthropic / google surface caveat when auto-resolved", () => {
    const anth = resolveAiModelBaseUrl({ provider: "anthropic" });
    expect(anth.baseUrl).toBe("https://api.anthropic.com/v1");
    expect(anth.tier2Caveat).toContain("testing/evaluation only");
    expect(anth.tier2Provider).toBe("anthropic");

    const google = resolveAiModelBaseUrl({ provider: "google" });
    expect(google.baseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai",
    );
    expect(google.tier2Caveat).toContain("tool");

    const gemini = resolveAiModelBaseUrl({ provider: "gemini" });
    expect(gemini.baseUrl).toBe(google.baseUrl);
    expect(gemini.tier2Caveat).toBe(google.tier2Caveat);
  });

  test("mock / local / openai-compatible exempt from unknown-provider error", () => {
    expect(resolveAiModelBaseUrl({ provider: "mock" })).toEqual({});
    expect(resolveAiModelBaseUrl({ provider: "local" })).toEqual({});
    expect(resolveAiModelBaseUrl({ provider: "openai-compatible" })).toEqual({});
    expect(() => resolveAiModelBaseUrl({ provider: "ollama" })).toThrow(/explicit baseUrl/);
  });
});

describe("ai.model provider registry", () => {
  test("auto-resolves openrouter baseUrl on declare", () => {
    const m = ai.model("smart", {
      provider: "openrouter",
      model: "openrouter/free",
      apiKey: "sk-or",
    });
    expect(m.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(m.apiKey).toBe("sk-or");
  });

  test("explicit baseUrl override wins on declare", () => {
    const m = ai.model("smart", {
      provider: "groq",
      baseUrl: "http://127.0.0.1:9000/v1",
      apiKey: "gsk",
    });
    expect(m.baseUrl).toBe("http://127.0.0.1:9000/v1");
  });

  test("unknown provider without baseUrl throws on declare", () => {
    expect(() => ai.model("x", { provider: "acme-llm" })).toThrow(
      /unknown provider "acme-llm" requires an explicit baseUrl/,
    );
  });

  test("native anthropic driverId does not inject /v1 openai-compat base", () => {
    const m = ai.model("claude", {
      provider: "anthropic",
      driverId: "anthropic",
      model: "claude-sonnet-4",
      apiKey: "sk-ant",
    });
    expect(m.baseUrl).toBeUndefined();
    expect(m.driverId).toBe("anthropic");
  });

  test("limited-compat declare warns with caveat text", () => {
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (msg?: unknown) => {
      warns.push(String(msg));
    };
    try {
      ai.model("eval-claude", { provider: "anthropic", model: "claude-sonnet-4" });
    } finally {
      console.warn = original;
    }
    expect(
      warns.some((w) => w.includes('provider "anthropic"') && w.includes("limited OpenAI-compatible")),
    ).toBe(
      true,
    );
    expect(warns.some((w) => w.includes("testing/evaluation only"))).toBe(true);
  });
});

describe("multi-provider apiKey isolation", () => {
  test("openrouter + groq open distinct clients with own baseUrl and apiKey", async () => {
    const opens: Array<{ baseUrl?: string; apiKey?: string; model?: string }> = [];
    const fetchFn = Object.assign(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "{}" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      { preconnect: () => {} },
    ) as typeof fetch;

    const driver = {
      id: "openai-compatible" as const,
      async open(opts: { model?: string; baseUrl?: string; apiKey?: string }) {
        opens.push({
          ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
          ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
          ...(opts.model !== undefined ? { model: opts.model } : {}),
        });
        return openaiCompatibleAiDriver.open({ ...opts, fetch: fetchFn });
      },
    };

    const or = ai.model("via-or", {
      provider: "openrouter",
      model: "openrouter/free",
      apiKey: "sk-openrouter",
    });
    const gq = ai.model("via-groq", {
      provider: "groq",
      model: "llama-3.1-8b-instant",
      apiKey: "gsk-groq",
    });
    const pOr = or.prompt("ping-or");
    const pGq = gq.prompt("ping-groq");

    const rt = createAiRuntime({
      models: [or, gq],
      prompts: [pOr, pGq],
      defaultDriver: driver,
    });

    await rt.ask("ping-or", {});
    await rt.ask("ping-groq", {});

    expect(opens).toHaveLength(2);
    expect(opens[0]).toEqual({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-openrouter",
      model: "openrouter/free",
    });
    expect(opens[1]).toEqual({
      baseUrl: "https://api.groq.com/openai/v1",
      apiKey: "gsk-groq",
      model: "llama-3.1-8b-instant",
    });
  });
});

describe("extract limited-compat provider warn", () => {
  test("warns when ai.model uses limited provider without baseUrl", async () => {
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (msg?: unknown) => {
      warns.push(String(msg));
    };
    try {
      await extractFromSources({
        "src/ai.ts": `
import { ai } from "okengine";
export const smart = ai.model("smart", { provider: "google", model: "gemini-2.5-flash" });
`,
      });
    } finally {
      console.warn = original;
    }
    expect(
      warns.some(
        (w) =>
          w.startsWith("[oke extract] warn:") &&
          w.includes('provider "google"') &&
          w.includes("limited OpenAI-compatible"),
      ),
    ).toBe(true);
  });

  test("does not warn for native anthropic driverId", async () => {
    const warns: string[] = [];
    const original = console.warn;
    console.warn = (msg?: unknown) => {
      warns.push(String(msg));
    };
    try {
      await extractFromSources({
        "src/ai.ts": `
import { ai } from "okengine";
export const claude = ai.model("claude", {
  provider: "anthropic",
  driverId: "anthropic",
  model: "claude-sonnet-4",
});
`,
      });
    } finally {
      console.warn = original;
    }
    expect(warns.some((w) => w.includes("limited OpenAI-compatible"))).toBe(false);
  });
});

describe("registry entries", () => {
  test("gemini aliases google", () => {
    expect(getAiProviderEntry("gemini")).toEqual(getAiProviderEntry("google"));
  });

  test("formatAiProviderTier2Warn prefixes correctly", () => {
    const entry = getAiProviderEntry("anthropic")!;
    expect(formatAiProviderTier2Warn("anthropic", entry.caveat!, "ai.model")).toContain(
      "ai.model: provider \"anthropic\"",
    );
  });
});
