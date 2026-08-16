/**
 * Prompt `out` — Zod / JSON Schema / shorthand, plus chat-envelope coerce.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { mockAiDriver } from "../../drivers/ai-mock.ts";
import { ai, resetAiDecls } from "./declare.ts";
import { createAiRuntime } from "./runtime.ts";

afterEach(() => {
  resetAiDecls();
});
import {
  coerceModelObject,
  fixtureFromJsonSchema,
  matchOutSchema,
  promptOutJsonSchema,
  promptResponseFormat,
  validatePromptOut,
} from "./schema.ts";

describe("promptOutJsonSchema", () => {
  test("converts Zod object out", () => {
    const schema = promptOutJsonSchema(z.object({ summary: z.string() }));
    expect(schema?.properties).toEqual({ summary: { type: "string" } });
    expect(schema?.required).toEqual(["summary"]);
  });

  test("passes JSON Schema through", () => {
    const json = {
      type: "object",
      properties: { summary: { type: "string" } },
      required: ["summary"],
    };
    expect(promptOutJsonSchema(json)).toEqual(json);
  });

  test("lifts { field: type } shorthand", () => {
    expect(promptOutJsonSchema({ answer: "string" })).toEqual({
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
    });
  });
});

describe("validatePromptOut", () => {
  test("Zod out rejects a mock echo object", () => {
    expect(() =>
      validatePromptOut("document-summary", 1, z.object({ summary: z.string() }), {
        ok: true,
        echo: "x",
      }),
    ).toThrow(/missing \[summary\]/);
  });

  test("Zod out accepts { summary }", () => {
    expect(
      validatePromptOut("document-summary", 1, z.object({ summary: z.string() }), {
        summary: "API is down",
      }),
    ).toEqual({ summary: "API is down" });
  });
});

describe("coerceModelObject", () => {
  test("unwraps chat.completion content JSON", () => {
    expect(
      coerceModelObject({
        object: "chat.completion",
        choices: [{ message: { content: '{"summary":"ok"}' } }],
      }),
    ).toEqual({ summary: "ok" });
  });
});

describe("fixtureFromJsonSchema", () => {
  test("fills required string fields", () => {
    expect(fixtureFromJsonSchema(z.object({ summary: z.string() }))).toEqual({ summary: "ok" });
  });
});

describe("promptResponseFormat", () => {
  test("wraps out as json_schema", () => {
    const rf = promptResponseFormat("document-summary", z.object({ summary: z.string() }));
    expect(rf?.type).toBe("json_schema");
    expect(rf?.json_schema).toMatchObject({ name: "document-summary", strict: true });
  });
});

describe("fx.ask Zod out", () => {
  test("mock fills declared summary instead of { ok, echo }", async () => {
    const fast = ai.model("fast", { provider: "mock" });
    const prompt = fast.prompt("document-summary", {
      version: 1,
      out: z.object({ summary: z.string() }),
    });
    const runtime = createAiRuntime({
      models: [fast],
      prompts: [prompt],
      defaultDriver: mockAiDriver,
    });
    const out = await runtime.ask("document-summary", { title: "API", body: "down" });
    expect(out.summary).toBe("ok");
  });

  test("resolves fx.ask name@version against the bare prompt id", async () => {
    const fast = ai.model("fast", { provider: "mock" });
    const prompt = fast.prompt("document-summary", {
      version: 1,
      out: z.object({ summary: z.string() }),
    });
    const runtime = createAiRuntime({
      models: [fast],
      prompts: [prompt],
      defaultDriver: mockAiDriver,
    });
    const out = await runtime.ask("document-summary@1", { title: "API", body: "down" });
    expect(out.summary).toBe("ok");
    await expect(runtime.ask("document-summary@2", { title: "API" })).rejects.toThrow(
      'ai: unknown prompt "document-summary@2"',
    );
  });
});

describe("matchOutSchema", () => {
  test("ignores via on the payload", () => {
    expect(
      matchOutSchema(z.object({ summary: z.string() }), { summary: "x", via: "fast" }),
    ).toBeNull();
  });
});
