/**
 * Smart local-model recommendations — machine-tier fit + use-case scoring.
 *
 * Catalog `ramGb` is the **recommended machine tier** for that model (not the
 * download size). A 24GB laptop must never be told it will "download a 24GB
 * model" — that number was machine RAM shown in the wrong place.
 *
 * Most dev machines are 8–16GB. Prefer picks that leave ~4GB for OS / IDE /
 * browser when several models fit.
 */

import { CHAT_MODELS, VISION_MODELS, type CatalogModel } from "./catalog.ts";

/** Reserved for OS + IDE + browser while the model runs. */
export const OS_HEADROOM_GB = 4;

/** What the developer mainly wants from the local model. */
export type AiUseCase = "coding" | "general" | "reasoning" | "balanced";

/** Speed vs quality preference. */
export type AiPriority = "speed" | "balanced" | "quality";

/** Answers from the short Ollama questionnaire. */
export type AiNeeds = {
  readonly useCase: AiUseCase;
  readonly priority: AiPriority;
  readonly wantVision: boolean;
};

/**
 * RAM left after reserving OS/IDE headroom.
 *
 * @param totalRamGb - Detected machine RAM
 */
export function usableRamGb(totalRamGb: number): number {
  return Math.max(0, totalRamGb - OS_HEADROOM_GB);
}

/**
 * Whether the machine meets the model's recommended tier (`model.ramGb`).
 *
 * @param model - Catalog entry
 * @param totalRamGb - Machine RAM (null → only the catalog default recommended)
 */
export function modelFitsOnMachine(model: CatalogModel, totalRamGb: number | null): boolean {
  if (totalRamGb === null || !Number.isFinite(totalRamGb)) {
    return Boolean(model.recommended);
  }
  return model.ramGb <= totalRamGb;
}

/**
 * Whether the model fits with comfortable headroom for OS/IDE.
 *
 * @param model - Catalog entry
 * @param totalRamGb - Machine RAM
 */
export function modelFitsComfortably(model: CatalogModel, totalRamGb: number | null): boolean {
  if (totalRamGb === null || !Number.isFinite(totalRamGb)) {
    return Boolean(model.recommended);
  }
  const smallest = [...CHAT_MODELS].sort((a, b) => a.ramGb - b.ramGb)[0]!;
  // Always allow the entry-level model on machines that meet its tier.
  if (model.id === smallest.id) return model.ramGb <= totalRamGb;
  return model.ramGb + OS_HEADROOM_GB <= totalRamGb;
}

/**
 * True when the model meets the tier but leaves little room for OS/IDE.
 *
 * @param model - Catalog entry
 * @param totalRamGb - Machine RAM
 */
export function isTightFit(model: CatalogModel, totalRamGb: number | null): boolean {
  if (totalRamGb === null || !Number.isFinite(totalRamGb)) return false;
  return modelFitsOnMachine(model, totalRamGb) && !modelFitsComfortably(model, totalRamGb);
}

/**
 * Chat models that meet the machine tier, smallest → largest.
 *
 * @param totalRamGb - Machine RAM
 */
export function fittingChatModels(totalRamGb: number | null): readonly CatalogModel[] {
  const fits = CHAT_MODELS.filter((m) => modelFitsOnMachine(m, totalRamGb));
  if (fits.length > 0) return [...fits].sort((a, b) => a.ramGb - b.ramGb);
  return [[...CHAT_MODELS].sort((a, b) => a.ramGb - b.ramGb)[0]!];
}

/**
 * Prefer comfortable fits; fall back to any tier-fit if needed.
 *
 * @param totalRamGb - Machine RAM
 */
export function comfortableChatModels(totalRamGb: number | null): readonly CatalogModel[] {
  const comfortable = CHAT_MODELS.filter((m) => modelFitsComfortably(m, totalRamGb));
  if (comfortable.length > 0) {
    return [...comfortable].sort((a, b) => a.ramGb - b.ramGb);
  }
  return fittingChatModels(totalRamGb);
}

/**
 * Score a fitting chat model for the user's needs (higher = better).
 *
 * @param model - Candidate
 * @param needs - Questionnaire answers
 * @param totalRamGb - Machine RAM (tight-fit penalty)
 */
export function scoreChatModel(
  model: CatalogModel,
  needs: AiNeeds,
  totalRamGb: number | null = null,
): number {
  let score = 0;
  if (needs.priority === "speed") score += 100 - model.ramGb * 3;
  else if (needs.priority === "quality") score += model.ramGb * 4;
  else score += model.ramGb * 2;

  if (needs.useCase === "coding") {
    if (model.id.startsWith("qwen")) score += 40;
    if (model.id.includes("deepseek")) score += 15;
  } else if (needs.useCase === "reasoning") {
    if (model.id.includes("deepseek") || model.id.includes("r1")) score += 45;
    if (model.id.startsWith("qwen")) score += 20;
  } else if (needs.useCase === "general") {
    if (model.id.includes("llama") || model.id.includes("gemma")) score += 35;
    if (model.id.startsWith("qwen")) score += 20;
  } else {
    if (model.recommended) score += 25;
    if (model.id.startsWith("qwen3.5:9b")) score += 30;
    if (model.id.startsWith("gemma")) score += 20;
  }

  // Prefer leaving OS/IDE headroom unless the user asked for max quality.
  if (isTightFit(model, totalRamGb) && needs.priority !== "quality") {
    score -= 35;
  }
  return score;
}

/**
 * Pick the best chat model for RAM + needs.
 *
 * @param totalRamGb - Machine RAM
 * @param needs - Questionnaire (defaults to balanced/speed-friendly)
 */
export function recommendChatForNeeds(
  totalRamGb: number | null,
  needs: AiNeeds = { useCase: "balanced", priority: "balanced", wantVision: false },
): CatalogModel {
  // Prefer comfortable pool; quality may still score a tight tier-fit higher.
  const pool =
    needs.priority === "quality"
      ? fittingChatModels(totalRamGb)
      : comfortableChatModels(totalRamGb);
  let best = pool[0]!;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const m of pool) {
    const s = scoreChatModel(m, needs, totalRamGb);
    if (s > bestScore) {
      best = m;
      bestScore = s;
    }
  }
  return best;
}

/**
 * Vision model that fits; null if user skipped or none fit.
 *
 * @param totalRamGb - Machine RAM
 * @param wantVision - From questionnaire
 */
export function recommendVisionForNeeds(
  totalRamGb: number | null,
  wantVision: boolean,
): CatalogModel | null {
  if (!wantVision) return null;
  const fits = VISION_MODELS.filter((m) => modelFitsOnMachine(m, totalRamGb));
  return fits.find((m) => m.recommended) ?? fits[0] ?? null;
}

/**
 * Human summary line for the recommendation panel.
 *
 * Separates **machine RAM** from **model tier** so "~24GB" is never read as
 * download size.
 *
 * @param totalRamGb - Machine RAM
 * @param chat - Chosen chat model
 */
export function formatMachineSummary(totalRamGb: number | null, chat: CatalogModel): string {
  if (totalRamGb === null || !Number.isFinite(totalRamGb)) {
    return `⭐ Suggested: ${chat.label} (≈${chat.ramGb}GB-class machine · not download size)`;
  }
  const budget = usableRamGb(totalRamGb);
  const tight = isTightFit(chat, totalRamGb) ? " · tight on this machine" : "";
  return [
    `Your machine: ~${totalRamGb}GB RAM (keep ~${OS_HEADROOM_GB}GB free for OS/IDE → ~${budget}GB model budget)`,
    `⭐ For you: ${chat.label} — ≈${chat.ramGb}GB-class (Ollama pull is usually much smaller than RAM)${tight}`,
  ].join("\n");
}
