/**
 * Duration severity shading for Traces — a fine ladder from fast → critical.
 *
 * Bands share cutoffs with {@link DURATION_THRESHOLD_OPTIONS} so row colors
 * and the duration filter speak the same language.
 */

/** Latency band for a run duration (cool → hot). */
export type DurationTone =
  | "fast"
  | "good"
  | "ok"
  | "elevated"
  | "warn"
  | "slow"
  | "bad"
  | "critical";

/**
 * Exclusive upper bounds (ms) for each tone except `critical`.
 * A duration lands in the first band whose upper bound it is below.
 */
export const DURATION_TONE_BOUNDS = [
  { tone: "fast", belowMs: 10 },
  { tone: "good", belowMs: 50 },
  { tone: "ok", belowMs: 100 },
  { tone: "elevated", belowMs: 250 },
  { tone: "warn", belowMs: 500 },
  { tone: "slow", belowMs: 1_000 },
  { tone: "bad", belowMs: 5_000 },
] as const;

/** Duration filter presets (ms). `null` = no threshold. */
export const DURATION_THRESHOLD_OPTIONS = [
  null,
  10,
  25,
  50,
  100,
  250,
  500,
  1_000,
  5_000,
] as const;

/** One duration-threshold preset value. */
export type DurationThresholdMs = (typeof DURATION_THRESHOLD_OPTIONS)[number];

/**
 * Classify a duration into a cool→hot tone band.
 *
 * @param ms - Duration in milliseconds
 */
export function durationTone(ms: number): DurationTone {
  if (!Number.isFinite(ms) || ms < 0) return "fast";
  for (const band of DURATION_TONE_BOUNDS) {
    if (ms < band.belowMs) return band.tone;
  }
  return "critical";
}

/**
 * Tailwind text classes for a duration tone (readable on light + dark).
 *
 * @param tone - Severity band
 */
export function durationToneClass(tone: DurationTone): string {
  switch (tone) {
    case "fast":
      return "text-emerald-500 dark:text-emerald-400";
    case "good":
      return "text-emerald-600 dark:text-emerald-300";
    case "ok":
      return "text-lime-600 dark:text-lime-400";
    case "elevated":
      return "text-yellow-600 dark:text-yellow-400";
    case "warn":
      return "text-amber-600 dark:text-amber-400";
    case "slow":
      return "text-orange-600 dark:text-orange-400";
    case "bad":
      return "text-destructive";
    case "critical":
      return "text-rose-700 dark:text-rose-400";
  }
}

/**
 * Tailwind border classes paired with a duration tone.
 *
 * @param tone - Severity band
 */
export function durationToneBorderClass(tone: DurationTone): string {
  switch (tone) {
    case "fast":
      return "border-emerald-500/45";
    case "good":
      return "border-emerald-600/40";
    case "ok":
      return "border-lime-500/40";
    case "elevated":
      return "border-yellow-500/45";
    case "warn":
      return "border-amber-500/45";
    case "slow":
      return "border-orange-500/45";
    case "bad":
      return "border-destructive/45";
    case "critical":
      return "border-rose-600/50";
  }
}

/**
 * Tailwind background classes for a solid duration-tone dot.
 *
 * @param tone - Severity band
 */
export function durationToneDotClass(tone: DurationTone): string {
  switch (tone) {
    case "fast":
      return "bg-emerald-500 dark:bg-emerald-400";
    case "good":
      return "bg-emerald-600 dark:bg-emerald-300";
    case "ok":
      return "bg-lime-500 dark:bg-lime-400";
    case "elevated":
      return "bg-yellow-500 dark:bg-yellow-400";
    case "warn":
      return "bg-amber-500 dark:bg-amber-400";
    case "slow":
      return "bg-orange-500 dark:bg-orange-400";
    case "bad":
      return "bg-destructive";
    case "critical":
      return "bg-rose-600 dark:bg-rose-400";
  }
}

/**
 * Dot fill for a duration-threshold preset (`null` = any / neutral).
 *
 * @param ms - Active threshold, or null for any
 */
export function durationThresholdDotClass(ms: number | null): string {
  if (ms === null) return "bg-muted-foreground/45";
  return durationToneDotClass(durationTone(ms));
}

/**
 * Tailwind text classes for a duration in ms.
 *
 * @param ms - Duration in milliseconds
 */
export function durationClassName(ms: number): string {
  return durationToneClass(durationTone(ms));
}

/**
 * Tailwind classes for the duration-threshold filter control.
 *
 * @param ms - Active threshold, or null for any
 */
export function durationThresholdFilterClass(ms: number | null): string {
  if (ms === null) {
    return "border-border/70 text-foreground";
  }
  const tone = durationTone(ms);
  return `${durationToneBorderClass(tone)} font-medium ${durationToneClass(tone)}`;
}
