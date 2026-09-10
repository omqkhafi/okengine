/**
 * Gate tests for EffectEntry.external + fx.fetch + driver-reported egress.
 */

import { describe, expect, test } from "bun:test";
import { openOpenaiCompatible } from "../drivers/ai-openai-compatible.ts";
import { openAnthropic } from "../drivers/ai-anthropic.ts";
import { connectPglite } from "../drivers/pglite.ts";
import { createChannelRuntime } from "../elements/channel/runtime.ts";
import { createFxContext } from "./fx.ts";
import { withDryRun } from "./dry-run.ts";

describe("EffectEntry.external — optional / additive", () => {
  test("ledger entries without external stay five-field shaped", async () => {
    const { fx, ledger } = createFxContext({
      flow: "local.read",
      effects: { reads: ["sql:notes"] },
    });
    await (fx.store("sql:notes") as { get(key: string): Promise<unknown> }).get("n1");
    const entry = ledger.entries[0];
    expect(entry).toMatchObject({
      kind: "read",
      resource: "sql:notes",
      reversibility: "none",
    });
    expect(entry?.external).toBeUndefined();
  });
});

describe("fx.fetch", () => {
  test("records fetch kind with third-party host from URL", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    try {
      const { fx, ledger } = createFxContext({
        flow: "stripe.pull",
        effects: { fetches: ["api.stripe.com"] },
      });
      const res = await fx.fetch("https://api.stripe.com/v1/charges");
      expect(res.status).toBe(200);
      expect(ledger.entries).toHaveLength(1);
      expect(ledger.entries[0]).toMatchObject({
        kind: "fetch",
        resource: "api.stripe.com",
        reversibility: "irreversible",
        external: { host: "api.stripe.com", kind: "third-party" },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("undeclared host throws UNDECLARED_FETCH", async () => {
    const { fx } = createFxContext({
      flow: "stripe.pull",
      effects: { fetches: ["api.example.com"] },
    });
    await expect(fx.fetch("https://api.stripe.com/v1")).rejects.toMatchObject({
      code: 1008,
    });
  });

  test("dry-run stubs fetch without contacting the network", async () => {
    let called = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("nope");
    }) as unknown as typeof fetch;
    try {
      const { fx, ledger } = createFxContext({
        flow: "stripe.pull",
        effects: { fetches: ["api.stripe.com"] },
      });
      const { wouldHaveFired } = await withDryRun(async () => {
        await fx.fetch("https://api.stripe.com/v1");
      });
      expect(called).toBe(false);
      expect(wouldHaveFired).toEqual([{ kind: "fetch", resource: "api.stripe.com" }]);
      expect(ledger.entries[0]?.external).toMatchObject({
        host: "api.stripe.com",
        kind: "third-party",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Channel failover — winning provider on EffectEntry", () => {
  test("send stamps external.provider from the winning attempt, not the primary binding", async () => {
    const { channel } = await import("../elements/channel.ts");
    const { driverFromTransport, failingTransport, okTransport } =
      await import("../elements/channel/test-helpers.ts");
    const smtp = {
      ...driverFromTransport("smtp", failingTransport("smtp")),
      external: {
        host: "mail.example.internal",
        provider: "smtp",
        kind: "infrastructure" as const,
      },
    };
    const resend = {
      ...driverFromTransport("resend", okTransport("resend")),
      external: {
        host: "api.resend.com",
        provider: "resend",
        kind: "third-party" as const,
      },
    };
    const channelRuntime = createChannelRuntime({
      templates: [channel.template("welcome", { medium: "email" })],
      drivers: [smtp, resend],
      catalog: { welcome: { en: { subject: "Hi", text: "Hello" } } },
    });
    const { fx, ledger } = createFxContext({
      flow: "mail.send",
      effects: { sends: ["welcome"] },
      channelRuntime,
    });
    await fx.send("welcome", { to: "a@b.com", via: ["smtp", "resend"] });
    const send = ledger.entries.find((e) => e.kind === "send");
    expect(send?.external?.provider).toBe("resend");
    expect(send?.external?.host).toBe("api.resend.com");
    expect(send?.external?.kind).toBe("third-party");
  });
});

describe("Store — in-process PGlite never carries external", () => {
  test("pglite connection omits external", async () => {
    const conn = await connectPglite({ url: "memory://" });
    expect(conn.driverId).toBe("pglite");
    expect(conn.external).toBeUndefined();
    await conn.close?.();
  });
});

describe("AI — infrastructure vs third-party", () => {
  test("self-hosted openai-compatible reports infrastructure when opened with that kind", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "hi" } }],
          model: "llama3",
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    try {
      const client = await openOpenaiCompatible({
        baseUrl: "http://127.0.0.1:11434/v1",
        external: { kind: "infrastructure", provider: "local" },
      });
      const result = await client.complete({
        messages: [{ role: "user", content: "hi" }],
      });
      expect(result.external).toEqual({
        host: "127.0.0.1",
        kind: "infrastructure",
        provider: "local",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("anthropic cloud reports third-party", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          content: [{ type: "text", text: "hi" }],
          model: "claude",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    try {
      const client = await openAnthropic({
        apiKey: "sk-test",
        baseUrl: "https://api.anthropic.com",
      });
      const result = await client.complete({
        messages: [{ role: "user", content: "hi" }],
      });
      expect(result.external).toEqual({
        host: "api.anthropic.com",
        kind: "third-party",
        provider: "anthropic",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
