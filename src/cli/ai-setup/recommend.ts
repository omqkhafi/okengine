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
 * Shared hardware lines for local AI banners.
 *
 * @param machine - Detected hardware
 */
function formatMachineBannerLines(machine: {
  readonly osName: string;
  readonly cpuCount: number | null;
  readonly ramGb: number | null;
}): readonly string[] {
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
  return [[`OS ${machine.osName}`, `CPU ${cpu}`, `RAM ${ram}`].join(sep), `Fit RAM ${fit}`];
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
  const sep = "  ·  ";
  const lines = [
    ...formatMachineBannerLines(machine),
    "",
    "Detected local models",
    ...(detectedIds.length > 0 ? detectedIds.map((id) => id) : ["(none detected)"]),
    "",
    `Tiers${sep}${MODEL_TIERS.map((t) => t.label).join(sep)}`,
  ];
  return lines.join("\n");
}

/**
 * llama.cpp banner — OS · CPU · RAM · fit · Docker Hub `ai/` source · tiers.
 *
 * @param machine - Detected hardware
 */
export function formatLlamaCppBanner(machine: {
  readonly osName: string;
  readonly cpuCount: number | null;
  readonly ramGb: number | null;
}): string {
  const sep = "  ·  ";
  const lines = [
    ...formatMachineBannerLines(machine),
    "",
    "Model source",
    "Docker Hub ai/ (curated) — pulled on first container start",
    "",
    `Tiers${sep}${MODEL_TIERS.map((t) => t.label).join(sep)}`,
  ];
  return lines.join("\n");
}

/** Model name column width (monospace CLI table). */
const MODEL_COL_NAME = 26;
/** RAM column width, right-aligned (`≈32GB`). */
const MODEL_COL_RAM = 7;

/**
 * Clip or pad a cell for aligned CLI columns.
 *
 * @param value - Cell text
 * @param width - Fixed width
 */
function clipPad(value: string, width: number): string {
  const bunAnsi = Bun as typeof Bun & {
    stringWidth(text: string): number;
    sliceAnsi(text: string, start: number, end: number, omission?: string): string;
  };
  const display = bunAnsi.stringWidth(value);
  if (display === width) return value;
  if (display < width) return value + " ".repeat(width - display);
  return bunAnsi.sliceAnsi(value, 0, width, "…");
}

/**
 * Column header for the model pick list (aligns with {@link formatModelRow}).
 */
export function formatModelTableHeader(): string {
  return `${clipPad("Model", MODEL_COL_NAME)}  ${"RAM".padStart(MODEL_COL_RAM)}  Caps`;
}

/**
 * One model row as aligned columns: Model | RAM | Caps.
 *
 * @param model - Catalog entry
 */
export function formatModelRow(model: CatalogModel): string {
  const name = clipPad(model.label, MODEL_COL_NAME);
  const ram = `≈${model.ramGb}GB`.padStart(MODEL_COL_RAM);
  const caps = model.modalities.join(" · ");
  return `${name}  ${ram}  ${caps}`;
}
