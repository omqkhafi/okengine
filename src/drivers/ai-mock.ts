/**
 * `mock` AI driver — deterministic responses for tests / `oke test`.
 *
 * Dev default. Never a production default.
 */

import type {
  AiCompleteOptions,
  AiCompleteResult,
  AiDriver,
  AiEmbedOptions,
  AiEmbedResult,
  AiModelClient,
  AiOpenOptions,
  AiStreamChunk,
  AiToolCall,
} from "./ai-types.ts";

/** Scripted mock tool-call turn (optional). */
export type MockToolCallScript = {
  readonly toolCalls: readonly AiToolCall[];
  readonly text?: string;
};

/**
 * Create a mock AI driver.
 */
export const mockAiDriver: AiDriver = {
  id: "mock",
  async open(options: AiOpenOptions = {}): Promise<AiModelClient> {
    const model = options.model ?? "mock";
    const canned = options.mockResponses ?? {};

    return {
      driverId: "mock",
      model,
      async complete(opts: AiCompleteOptions): Promise<AiCompleteResult> {
        if (opts.signal?.aborted) {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          throw err;
        }
        const last = opts.messages[opts.messages.length - 1]?.content ?? "";
        let payload: unknown | undefined;
        for (const [key, value] of Object.entries(canned)) {
          if (key === "*") continue;
          if (last.includes(key) || opts.model === key) {
            payload = value;
            break;
          }
        }
        if (payload === undefined) {
          payload = canned["*"] ??
            fixtureFromResponseFormat(opts.responseFormat) ?? { ok: true, echo: last };
        }

        // Scripted tool calls: `{ __toolCalls: [...] }` or MockToolCallScript shape
        if (
          payload &&
          typeof payload === "object" &&
          payload !== null &&
          "__toolCalls" in payload
        ) {
          const script = payload as { __toolCalls: readonly AiToolCall[]; text?: string };
          const text = script.text ?? "";
          return {
            text,
            raw: payload,
            model: opts.model ?? model,
            driverId: "mock",
            toolCalls: script.__toolCalls,
            usage: { inputTokens: last.length, outputTokens: text.length, cost: 0 },
          };
        }

        const text = typeof payload === "string" ? payload : JSON.stringify(payload);
        return {
          text,
          raw: payload,
          model: opts.model ?? model,
          driverId: "mock",
          usage: { inputTokens: last.length, outputTokens: text.length, cost: 0 },
        };
      },
      async *stream(opts: AiCompleteOptions): AsyncIterable<AiStreamChunk> {
        if (opts.signal?.aborted) {
          const err = new Error("This operation was aborted");
          err.name = "AbortError";
          throw err;
        }
        const last = opts.messages[opts.messages.length - 1]?.content ?? "";
        let payload: unknown = canned["*"] ?? last;
        for (const [key, value] of Object.entries(canned)) {
          if (key === "*") continue;
          if (last.includes(key) || opts.model === key) {
            payload = value;
            break;
          }
        }
        const text = typeof payload === "string" ? payload : JSON.stringify(payload);
        const size = Math.max(1, Math.ceil(text.length / 3));
        for (let i = 0; i < text.length; i += size) {
          if (opts.signal?.aborted) {
            const err = new Error("This operation was aborted");
            err.name = "AbortError";
            throw err;
          }
          yield { text: text.slice(i, i + size) };
        }
        yield { text: "", done: true };
      },
      async embed(opts: AiEmbedOptions): Promise<AiEmbedResult> {
        const inputs = Array.isArray(opts.input) ? opts.input : [opts.input];
        const vectors = inputs.map((text) => {
          // Tiny deterministic bag-of-chars embedding for tests
          const v = new Array<number>(8).fill(0);
          for (let i = 0; i < text.length; i++) {
            v[i % 8]! += text.charCodeAt(i) / 255;
          }
          return v;
        });
        return { vectors, model: opts.model ?? model, driverId: "mock" };
      },
    };
  },
};

/**
 * Build a schema-shaped payload from `response_format.json_schema`.
 *
 * @param responseFormat - Runtime response format
 */
function fixtureFromResponseFormat(responseFormat: unknown): Record<string, unknown> | undefined {
  if (!responseFormat || typeof responseFormat !== "object") return undefined;
  const wrapped = (responseFormat as { json_schema?: { schema?: unknown } }).json_schema?.schema;
  const schema =
    wrapped && typeof wrapped === "object"
      ? wrapped
      : "properties" in responseFormat
        ? responseFormat
        : undefined;
  if (!schema || typeof schema !== "object" || !("properties" in schema)) return undefined;
  const props = (schema as { properties?: Record<string, unknown> }).properties ?? {};
  const requiredRaw = (schema as { required?: unknown }).required;
  const required = Array.isArray(requiredRaw) ? (requiredRaw as string[]) : Object.keys(props);
  const out: Record<string, unknown> = {};
  for (const key of required) {
    const spec = props[key];
    const type =
      spec && typeof spec === "object" && "type" in spec
        ? String((spec as { type?: unknown }).type)
        : "string";
    out[key] =
      type === "number" || type === "integer"
        ? 0
        : type === "boolean"
          ? true
          : type === "array"
            ? []
            : type === "object"
              ? {}
              : "ok";
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Register a mock response helper for tests.
 *
 * @param responses - Key → JSON payload
 */
export function createMockAiDriver(responses: Readonly<Record<string, unknown>>): AiDriver {
  return {
    id: "mock",
    open(options = {}) {
      return mockAiDriver.open({ ...options, mockResponses: responses });
    },
  };
}
