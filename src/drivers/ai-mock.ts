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
} from "./ai-types.ts";

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
          payload = canned["*"] ?? { ok: true, echo: last };
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
