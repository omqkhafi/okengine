/**
 * OpenRouter Decisions driver. `POST https://openrouter.ai/api/alpha/decisions`.
 */

import { decisionHttp } from "./http.ts";
import type { DecisionProvider, DecisionRequest, DecisionResponse } from "./provider.ts";

/** Default OpenRouter decisions URL. */
export const OPENROUTER_DECISION_URL = "https://openrouter.ai/api/alpha/decisions";

/** Default Jev model id on OpenRouter. */
export const OPENROUTER_JEV_MODEL = "typesafe/jev-1.13";

/**
 * OpenRouter decision provider. This is the default when a decision omits `model`.
 *
 * @param apiKey - `OPENROUTER_API_KEY`
 * @param timeoutMs - Provider deadline
 */
export function createOpenRouterDecisionProvider(
  apiKey: string,
  timeoutMs = 30_000,
): DecisionProvider {
  return {
    id: "openrouter",
    evaluate(request: DecisionRequest): Promise<DecisionResponse> {
      return decisionHttp({
        url: OPENROUTER_DECISION_URL,
        apiKey,
        request: { ...request, model: request.model || OPENROUTER_JEV_MODEL },
        timeoutMs,
        breakerKey: "openrouter",
      });
    },
  };
}
