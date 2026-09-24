/**
 * Opt-in OpenRouter agent stream.
 *
 * Skipped unless `OPENROUTER_API_KEY` is set. `bun run test` ignores
 * `*.live.test.ts`. The key is never printed.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { openOpenaiCompatible } from "../../drivers/ai-openai-compatible.ts";

function openRouterKey(): string | undefined {
  const fromEnv = process.env["OPENROUTER_API_KEY"];
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  try {
    const text = readFileSync(resolve(import.meta.dir, "../../../.env.local"), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("OPENROUTER_API_KEY=")) continue;
      const value = trimmed.slice("OPENROUTER_API_KEY=".length).replace(/^["']|["']$/g, "");
      if (value.length > 0) return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

const apiKey = process.env["CI"] === "true" ? undefined : openRouterKey();

describe.skipIf(apiKey === undefined)("openrouter agent stream live", () => {
  test("a tool call streams split args and matches complete()", async () => {
    const client = await openOpenaiCompatible({
      apiKey,
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openrouter/free",
    });
    const messages = [
      {
        role: "user" as const,
        content:
          "Call orders_get with id 14 and note set to exactly: alpha bravo charlie delta echo foxtrot golf hotel india juliet. No prose.",
      },
    ];
    const tools = [
      {
        name: "orders_get",
        description: "Look up an order",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string" },
            note: { type: "string" },
          },
          required: ["id", "note"],
        },
      },
    ];
    let name = "";
    const streamedArgs: string[] = [];
    for await (const chunk of client.stream!({ messages, tools, model: "openrouter/free" })) {
      if (chunk.toolCall?.name) name = chunk.toolCall.name;
      if (chunk.toolCall?.argumentsDelta) streamedArgs.push(chunk.toolCall.argumentsDelta);
    }
    expect(name).toBe("orders_get");
    expect(streamedArgs.length).toBeGreaterThan(1);
    const assembled = JSON.parse(streamedArgs.join("")) as { id?: string; note?: string };
    expect(assembled.id).toBe("14");
    expect(typeof assembled.note).toBe("string");
    const completed = await client.complete({ messages, tools, model: "openrouter/free" });
    const call = completed.toolCalls?.[0];
    expect(call?.name).toBe(name);
    expect(call?.arguments).toEqual(assembled);
  }, 60_000);
});
