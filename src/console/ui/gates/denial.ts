/**
 * Format the typed gate denial the client would receive (console §9.7).
 */

import type { GateDenialRecord, GateEvaluationRecord } from "./types.ts";

/**
 * Human-readable denial line matching the client envelope.
 *
 * @param denial - Typed denial
 */
export function formatDenial(denial: GateDenialRecord): string {
  switch (denial.code) {
    case "RateLimited": {
      const ms = typeof denial.data.retryAfterMs === "number" ? denial.data.retryAfterMs : 0;
      return `RateLimited { retryAfterMs: ${ms} } · HTTP ${denial.status}`;
    }
    case "Forbidden": {
      const gate = typeof denial.data.gate === "string" ? denial.data.gate : "?";
      const reason = typeof denial.data.reason === "string" ? denial.data.reason : "";
      return `Forbidden { gate: ${gate}${reason ? `, reason: ${reason}` : ""} } · HTTP ${denial.status}`;
    }
    case "Unauthorized":
      return `Unauthorized {} · HTTP ${denial.status}`;
  }
}

/**
 * Format one evaluation step in registration order.
 *
 * @param evaluation - Step
 * @param index - 0-based order
 */
export function formatEvaluationStep(evaluation: GateEvaluationRecord, index: number): string {
  const mark = evaluation.allowed ? "pass" : "deny";
  const extra =
    evaluation.kind === "rate" && evaluation.retryAfterMs !== undefined
      ? ` · retryAfterMs ${evaluation.retryAfterMs}`
      : evaluation.reason
        ? ` · ${evaluation.reason}`
        : "";
  return `${index + 1}. ${evaluation.name} — ${mark}${extra}`;
}
