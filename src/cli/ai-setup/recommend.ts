/**
 * Machine fit helpers for local Ollama model picks.
 *
 * Catalog `ramGb` is the **recommended machine tier** for that model (not the
 * download size). Prefer picks that leave ~4GB for OS / IDE / browser.
 */

import {
  CHAT_MODELS,
  MODEL_TIERS,
  type CatalogModel,
  type ModelTier,
  recommendForTier,
} from "./catalog.ts";

/** Reserved for OS + IDE + browser while the model runs. */
export const OS_HEADROOM_GB = 4;

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
 * Suggest a tier for the machine's fit RAM budget.
 *
 * @param totalRamGb - Machine RAM
 */
export function suggestTierForRam(totalRamGb: number | null): ModelTier {
  if (totalRamGb === null || !Number.isFinite(totalRamGb)) return "fast";
  const budget = usableRamGb(totalRamGb);
  if (budget >= 24) return "smart";
  if (budget >= 8) return "balanced";
  if (budget >= 4) return "fast";
  return "ultra-fast";
}

/**
 * Recommend a chat model for host RAM (balanced default — no quiz).
 *
 * @param totalRamGb - Machine RAM
 */
export function recommendChatForNeeds(totalRamGb: number | null): CatalogModel {
  return recommendForTier(suggestTierForRam(totalRamGb), totalRamGb);
}

/**
 * Ollama banner lines — OS · CPU · RAM · fit · detected · tiers.
 *
 * @param machine - Detected hardware
 * @param detectedIds - Installed model ids
 */
export function formatOllamaBanner(
  machine: {
    readonly osName: string;
    readonly cpuCount: number | null;
    readonly ramGb: number | null;
  },
  detectedIds: readonly string[],
): string {
  const ram =
    machine.ramGb !== null && Number.isFinite(machine.ramGb)
      ? `~${machine.ramGb}GB RAM`
      : "RAM unknown";
  const cpu =
    machine.cpuCount !== null && Number.isFinite(machine.cpuCount) ? String(machine.cpuCount) : "?";
  const fit =
    machine.ramGb !== null && Number.isFinite(machine.ramGb)
      ? `~${usableRamGb(machine.ramGb)}GB RAM`
      : "unknown";

  const sep = "  ·  ";
  const lines = [
    [`OS ${machine.osName}`, `CPU ${cpu}`, `RAM ${ram}`].join(sep),
    `Fit RAM ${fit}`,
    "",
    "Detected local models",
    ...(detectedIds.length > 0 ? detectedIds.map((id) => id) : ["(none detected)"]),
    "",
    `Tiers${sep}${MODEL_TIERS.map((t) => t.label).join(sep)}`,
  ];
  return lines.join("\n");
}

/**
 * One model row: name  ·  RAM  ·  modalities (equal spacing).
 *
 * @param model - Catalog entry
 */
export function formatModelRow(model: CatalogModel): string {
  return [model.label, `≈${model.ramGb}GB`, model.modalities.join("  ·  ")].join("  ·  ");
}
