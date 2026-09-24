/**
 * TypeSafe System One driver. `POST https://api.typesafe.ai/v1/systemone`.
 */

import { decisionHttp } from "./http.ts";
import type { DecisionProvider, DecisionRequest, DecisionResponse } from "./provider.ts";

/** Default TypeSafe evaluation URL. */
export const TYPESAFE_DECISION_URL = "https://api.typesafe.ai/v1/systemone";

/** Pinned Jev version when the author selects the TypeSafe driver. */
export const TYPESAFE_JEV_MODEL = "jev-1.13.0";

/**
 * TypeSafe decision provider.
 *
 * @param apiKey - `TYPESAFE_API_KEY`
 * @param timeoutMs - Provider deadline
 */
export function createTypesafeDecisionProvider(
  apiKey: string,
  timeoutMs = 30_000,
): DecisionProvider {
  return {
    id: "typesafe",
    evaluate(request: DecisionRequest): Promise<DecisionResponse> {
      return decisionHttp({
        url: TYPESAFE_DECISION_URL,
        apiKey,
        request: { ...request, model: request.model || TYPESAFE_JEV_MODEL },
        timeoutMs,
        breakerKey: "typesafe",
      });
    },
  };
}
