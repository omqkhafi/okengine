/**
 * `anthropic` AI driver — thin HTTP client for the Anthropic Messages API.
 *
 * Injectable `fetch` (same DI shape as postgres/redis/s3 `client`) so tests
 * substitute a fake. Never a production default — prod must declare.
 */

import type {
  AiCompleteOptions,
  AiCompleteResult,
  AiDriver,
  AiModelClient,
  AiOpenOptions,
} from "./ai-types.ts";

const DEFAULT_BASE = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Open an Anthropic Messages API client.
 *
 * @param options - API key / model / base URL / injectable fetch
 */
export async function openAnthropic(options: AiOpenOptions = {}): Promise<AiModelClient> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("anthropic: apiKey is required (or ANTHROPIC_API_KEY)");
  }
  const model = options.model ?? "claude-sonnet-4-20250514";
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  const fetchFn = options.fetch ?? globalThis.fetch;

  return {
    driverId: "anthropic",
    model,
    async complete(opts: AiCompleteOptions): Promise<AiCompleteResult> {
      const resolvedModel = opts.model ?? model;
      const { system, messages } = splitSystem(opts.messages);
      const res = await fetchFn(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: resolvedModel,
          max_tokens: opts.maxTokens ?? 1024,
          ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
          ...(system !== undefined ? { system } : {}),
          messages,
        }),
      });
      const raw = (await res.json().catch(() => ({}))) as AnthropicMessagesResponse;
      if (!res.ok) {
        const msg = raw.error?.message ?? `anthropic HTTP ${res.status}`;
        throw new Error(`anthropic: ${msg}`);
      }
      const text = textFromContent(raw.content);
      return {
        text,
        raw,
        model: raw.model ?? resolvedModel,
        driverId: "anthropic",
        usage: {
          inputTokens: raw.usage?.input_tokens,
          outputTokens: raw.usage?.output_tokens,
        },
      };
    },
  };
}

/** Protocol-named anthropic driver. */
export const anthropicAiDriver: AiDriver = {
  id: "anthropic",
  open: openAnthropic,
};

interface AnthropicMessagesResponse {
  readonly model?: string;
  readonly content?: readonly { readonly type?: string; readonly text?: string }[];
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
  readonly error?: { readonly message?: string };
}

function splitSystem(messages: AiCompleteOptions["messages"]): {
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemParts: string[] = [];
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
      continue;
    }
    if (m.role === "tool") {
      out.push({ role: "user", content: m.content });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return {
    ...(systemParts.length > 0 ? { system: systemParts.join("\n\n") } : {}),
    messages: out,
  };
}

function textFromContent(content: AnthropicMessagesResponse["content"]): string {
  if (!content?.length) return "";
  return content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text!)
    .join("");
}
