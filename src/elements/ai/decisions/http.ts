/**
 * Raw decision HTTP: deadline, 429/529 retry, and a breaker that ignores 401/402/422.
 */

import {
  DecisionOutageError,
  DecisionRequestError,
  type DecisionRequest,
  type DecisionResponse,
  type DecisionUsage,
} from "./provider.ts";

/** Fetch used by {@link decisionHttp}. Tests inject this. */
export type DecisionFetch = (input: string, init: RequestInit) => Promise<Response>;

/** Options for one decision POST. */
export interface DecisionHttpOptions {
  readonly url: string;
  readonly apiKey: string;
  readonly request: DecisionRequest;
  readonly timeoutMs: number;
  readonly fetch?: DecisionFetch;
  /** Max attempts including the first. Default 3. */
  readonly attempts?: number;
  /** Breaker key. Calls that share it share the open/closed state. */
  readonly breakerKey: string;
}

interface BreakerState {
  failures: number;
  openUntil: number;
}

const breakers = new Map<string, BreakerState>();

const FAILURES_TO_OPEN = 3;
const OPEN_MS = 30_000;

/**
 * Reset breaker state. Tests only.
 */
export function resetDecisionBreakers(): void {
  breakers.clear();
}

/**
 * Whether `key` is currently open.
 *
 * @param key - Breaker key
 * @param now - Clock
 */
export function decisionBreakerOpen(key: string, now: number = Date.now()): boolean {
  const state = breakers.get(key);
  return state !== undefined && state.openUntil > now;
}

function noteFailure(key: string, now: number): void {
  const state = breakers.get(key) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= FAILURES_TO_OPEN) state.openUntil = now + OPEN_MS;
  breakers.set(key, state);
}

function noteSuccess(key: string): void {
  breakers.delete(key);
}

function retryAfterMs(res: Response): number {
  const header = res.headers.get("retry-after");
  const seconds = header === null ? Number.NaN : Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  return 250;
}

function usageFrom(raw: unknown): DecisionUsage {
  if (!raw || typeof raw !== "object") return {};
  const usage = raw as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cost?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
  };
  const input = usage.input_tokens ?? usage.inputTokens;
  const output = usage.output_tokens ?? usage.outputTokens;
  return {
    ...(typeof input === "number" ? { inputTokens: input } : {}),
    ...(typeof output === "number" ? { outputTokens: output } : {}),
    ...(typeof usage.cost === "number" ? { cost: usage.cost } : {}),
  };
}

/**
 * Parse a provider JSON body into {@link DecisionResponse}.
 *
 * @param body - Parsed JSON
 */
export function parseDecisionResponse(body: unknown): DecisionResponse {
  if (!body || typeof body !== "object") {
    throw new DecisionRequestError(422, "decision response was not an object");
  }
  const record = body as {
    model?: unknown;
    provider?: unknown;
    answers?: unknown;
    usage?: unknown;
  };
  if (typeof record.model !== "string" || !record.answers || typeof record.answers !== "object") {
    throw new DecisionRequestError(422, "decision response missing model or answers");
  }
  return {
    model: record.model,
    ...(typeof record.provider === "string" ? { provider: record.provider } : {}),
    answers: record.answers as Readonly<Record<string, unknown>>,
    usage: usageFrom(record.usage),
  };
}

/**
 * POST one decision request.
 *
 * @param options - URL, key, body, deadline, breaker
 */
export async function decisionHttp(options: DecisionHttpOptions): Promise<DecisionResponse> {
  const now = Date.now();
  if (decisionBreakerOpen(options.breakerKey, now)) {
    throw new DecisionOutageError(`decision breaker open for ${options.breakerKey}`);
  }
  const fetchImpl = options.fetch ?? fetch;
  const attempts = options.attempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const local = new AbortController();
    const timer = setTimeout(() => local.abort(), options.timeoutMs);
    const parent = options.request.signal;
    const onParent = () => local.abort();
    parent?.addEventListener("abort", onParent);
    try {
      const res = await fetchImpl(options.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: options.request.model,
          state: options.request.state,
          questions: options.request.questions,
        }),
        signal: local.signal,
      });
      if (res.status === 401 || res.status === 402 || res.status === 422) {
        const text = await res.text();
        throw new DecisionRequestError(res.status, text.slice(0, 500));
      }
      if (res.status === 429 || res.status === 529) {
        noteFailure(options.breakerKey, Date.now());
        lastError = new Error(`decision HTTP ${res.status}`);
        if (attempt < attempts) {
          await new Promise((resolve) => setTimeout(resolve, retryAfterMs(res)));
          continue;
        }
        throw new DecisionOutageError(`decision HTTP ${res.status}`);
      }
      if (res.status >= 500) {
        noteFailure(options.breakerKey, Date.now());
        lastError = new Error(`decision HTTP ${res.status}`);
        if (attempt < attempts) continue;
        throw new DecisionOutageError(`decision HTTP ${res.status}`);
      }
      if (!res.ok) {
        noteFailure(options.breakerKey, Date.now());
        throw new DecisionOutageError(`decision HTTP ${res.status}`);
      }
      const parsed = parseDecisionResponse(await res.json());
      noteSuccess(options.breakerKey);
      return parsed;
    } catch (err) {
      if (err instanceof DecisionRequestError) throw err;
      if (err instanceof DecisionOutageError) throw err;
      noteFailure(options.breakerKey, Date.now());
      lastError = err;
      if (attempt >= attempts) {
        throw new DecisionOutageError(
          err instanceof Error ? err.message : "decision transport failed",
        );
      }
    } finally {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParent);
    }
  }
  throw new DecisionOutageError(lastError instanceof Error ? lastError.message : "decision failed");
}
