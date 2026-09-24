/**
 * Decision provider contract. Chat drivers stay on {@link AiDriverId}.
 * Boolean questions are `noul` on the wire.
 */

/** Wire question sent in one batched request. */
export type WireQuestion =
  | {
      readonly type: "choice";
      readonly instructions: string;
      readonly criteria: Readonly<Record<string, string | null>>;
    }
  | {
      readonly type: "score";
      readonly instructions: string;
      readonly criteria: readonly string[];
    }
  | {
      readonly type: "noul";
      readonly instructions: string;
      readonly criteria?: { readonly true?: string; readonly false?: string };
    };

/** One provider call. */
export interface DecisionRequest {
  readonly model: string;
  readonly state: unknown;
  readonly questions: Readonly<Record<string, WireQuestion>>;
  readonly signal?: AbortSignal;
}

/** Token usage reported by the provider. */
export interface DecisionUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cost?: number;
}

/** Parsed provider body. `model` is the resolved version. */
export interface DecisionResponse {
  readonly model: string;
  readonly provider?: string;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly usage: DecisionUsage;
}

/** Driver id for a decision provider. */
export type DecisionDriverId = "typesafe" | "openrouter";

/**
 * One System One decision call.
 */
export interface DecisionProvider {
  readonly id: DecisionDriverId;
  /**
   * Evaluate every question against `state` in one request.
   *
   * @param request - Model, state, and questions
   */
  evaluate(request: DecisionRequest): Promise<DecisionResponse>;
}

/** Auth, billing, or a body the provider rejected. Does not open the breaker. */
export class DecisionRequestError extends Error {
  readonly status: 401 | 402 | 422;
  /**
   * @param status - HTTP status
   * @param message - Provider body, truncated by the caller
   */
  constructor(status: 401 | 402 | 422, message: string) {
    super(message);
    this.name = "DecisionRequestError";
    this.status = status;
  }
}

/** The breaker is open. Callers take the non-auto path. */
export class DecisionOutageError extends Error {
  /**
   * @param message - Why the call was not sent
   */
  constructor(message: string) {
    super(message);
    this.name = "DecisionOutageError";
  }
}
