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
  AiStreamChunk,
  AiToolCall,
} from "./ai-types.ts";
import { hostFromUrl } from "./external.ts";

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
  const preconnect = (fetchFn as { preconnect?: (href: string) => void }).preconnect;
  if (typeof preconnect === "function") {
    preconnect(baseUrl);
  }
  const host = hostFromUrl(baseUrl);
  const external = host
    ? {
        host,
        kind: options.external?.kind ?? ("third-party" as const),
        provider: options.external?.provider ?? "anthropic",
      }
    : undefined;

  return {
    driverId: "anthropic",
    model,
    async complete(opts: AiCompleteOptions): Promise<AiCompleteResult> {
      const resolvedModel = opts.model ?? model;
      const res = await fetchFn(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: anthropicHeaders(apiKey),
        body: JSON.stringify(anthropicBody(resolvedModel, opts)),
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      });
      const raw = (await res.json().catch(() => ({}))) as AnthropicMessagesResponse;
      if (!res.ok) {
        const msg = raw.error?.message ?? `anthropic HTTP ${res.status}`;
        throw new Error(`anthropic: ${msg}`);
      }
      const text = textFromContent(raw.content);
      const toolCalls = toolCallsFromContent(raw.content);
      return {
        text,
        raw,
        model: raw.model ?? resolvedModel,
        driverId: "anthropic",
        ...(toolCalls !== undefined ? { toolCalls } : {}),
        usage: {
          inputTokens: raw.usage?.input_tokens,
          outputTokens: raw.usage?.output_tokens,
        },
        ...(external !== undefined ? { external } : {}),
      };
    },
    async *stream(opts: AiCompleteOptions): AsyncIterable<AiStreamChunk> {
      const resolvedModel = opts.model ?? model;
      const res = await fetchFn(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: anthropicHeaders(apiKey),
        body: JSON.stringify({ ...anthropicBody(resolvedModel, opts), stream: true }),
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      });
      if (!res.ok) {
        const raw = (await res.json().catch(() => ({}))) as AnthropicMessagesResponse;
        const msg = raw.error?.message ?? `anthropic HTTP ${res.status}`;
        throw new Error(`anthropic: ${msg}`);
      }
      yield* readAnthropicSse(res, opts.signal);
    },
  };
}

/** Protocol-named anthropic driver. */
export const anthropicAiDriver: AiDriver = {
  id: "anthropic",
  open: openAnthropic,
};

interface AnthropicBlock {
  readonly type?: string;
  readonly text?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: unknown;
}

interface AnthropicMessagesResponse {
  readonly model?: string;
  readonly content?: readonly AnthropicBlock[];
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
  };
  readonly error?: { readonly message?: string };
}

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
  };
}

function anthropicBody(model: string, opts: AiCompleteOptions): Record<string, unknown> {
  const { system, messages } = splitSystem(opts.messages);
  return {
    model,
    max_tokens: opts.maxTokens ?? 1024,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(system !== undefined ? { system } : {}),
    messages,
    ...(opts.tools !== undefined && opts.tools.length > 0
      ? {
          tools: opts.tools.map((tool) => ({
            name: tool.name,
            ...(tool.description !== undefined ? { description: tool.description } : {}),
            input_schema: tool.parameters ?? { type: "object", properties: {} },
          })),
        }
      : {}),
  };
}

function splitSystem(messages: AiCompleteOptions["messages"]): {
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
} {
  const systemParts: string[] = [];
  const out: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
      continue;
    }
    if (m.role === "tool") {
      out.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId ?? "",
            content: m.content,
          },
        ],
      });
      continue;
    }
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      const blocks: unknown[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const call of m.toolCalls) {
        blocks.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments ?? {},
        });
      }
      out.push({ role: "assistant", content: blocks });
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

function toolCallsFromContent(
  content: AnthropicMessagesResponse["content"],
): readonly AiToolCall[] | undefined {
  const calls = (content ?? []).filter((block) => block.type === "tool_use" && block.name);
  if (calls.length === 0) return undefined;
  return calls.map((block, index) => ({
    id: block.id ?? `toolu_${index}`,
    name: block.name ?? "",
    arguments: block.input ?? {},
  }));
}

/**
 * Parse Anthropic Messages SSE into text and tool-call chunks.
 *
 * @param res - Streaming response
 * @param signal - Optional abort
 */
async function* readAnthropicSse(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<AiStreamChunk> {
  const stream = (res as Response & { textStream?: () => AsyncIterable<string> }).textStream;
  if (typeof stream !== "function") {
    throw new Error("anthropic: Response.textStream is required (Bun >= 1.4.2)");
  }
  let buffer = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  for await (const piece of stream.call(res)) {
    if (signal?.aborted) {
      const err = new Error("This operation was aborted");
      err.name = "AbortError";
      throw err;
    }
    buffer += piece;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let event: {
        type?: string;
        index?: number;
        content_block?: AnthropicBlock;
        delta?: {
          type?: string;
          text?: string;
          partial_json?: string;
          stop_reason?: string;
        };
        message?: { usage?: { input_tokens?: number; output_tokens?: number } };
        usage?: { output_tokens?: number; input_tokens?: number };
      };
      try {
        event = JSON.parse(data) as typeof event;
      } catch {
        continue;
      }
      if (event.type === "message_start") {
        inputTokens = event.message?.usage?.input_tokens ?? inputTokens;
        continue;
      }
      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        yield {
          text: "",
          toolCall: {
            index: event.index ?? 0,
            ...(event.content_block.id !== undefined ? { id: event.content_block.id } : {}),
            ...(event.content_block.name !== undefined ? { name: event.content_block.name } : {}),
            argumentsDelta: "",
          },
        };
        continue;
      }
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
        if (event.delta.text) yield { text: event.delta.text };
        continue;
      }
      if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
        yield {
          text: "",
          toolCall: {
            index: event.index ?? 0,
            ...(event.delta.partial_json !== undefined
              ? { argumentsDelta: event.delta.partial_json }
              : {}),
          },
        };
        continue;
      }
      if (event.type === "message_delta") {
        outputTokens = event.usage?.output_tokens ?? outputTokens;
        inputTokens = event.usage?.input_tokens ?? inputTokens;
      }
    }
  }
  yield {
    text: "",
    done: true,
    ...((inputTokens !== undefined || outputTokens !== undefined)
      ? {
          usage: {
            ...(inputTokens !== undefined ? { inputTokens } : {}),
            ...(outputTokens !== undefined ? { outputTokens } : {}),
          },
        }
      : {}),
  };
}
