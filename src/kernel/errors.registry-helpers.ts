/**
 * Registry gate helpers — uniqueness, domain-range correctness, lazy discovery.
 * Used only by `errors.registry.test.ts` (not a public runtime API).
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { OKE_ERROR_RANGES, type OkeErrorDefinition, type OkeErrorDomain } from "./errors.ts";

const LAZY_FILE_RE = /^errors-.+\.ts$/;

/** True when `value` looks like a full {@link OkeErrorDefinition}. */
export function isOkeErrorDefinition(value: unknown): value is OkeErrorDefinition {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === "number" &&
    Number.isInteger(v.code) &&
    typeof v.domain === "string" &&
    typeof v.cause === "string" &&
    typeof v.fix === "string"
  );
}

/** Collect every `OkeErrorDefinition` export from a module namespace. */
export function collectDefsFromModule(mod: Record<string, unknown>): readonly OkeErrorDefinition[] {
  const out: OkeErrorDefinition[] = [];
  for (const value of Object.values(mod)) {
    if (isOkeErrorDefinition(value)) out.push(value);
  }
  return out;
}

/**
 * Discover lazy error chunks: every `errors-*.ts` file in `dir`
 * (excludes `errors.ts` itself via the hyphen requirement).
 *
 * @param dir - Absolute directory to scan (typically `import.meta.dir`)
 */
export async function discoverLazyErrorDefs(dir: string): Promise<{
  readonly files: readonly string[];
  readonly defs: readonly OkeErrorDefinition[];
}> {
  const names = (await readdir(dir)).filter((name) => LAZY_FILE_RE.test(name)).sort();
  const defs: OkeErrorDefinition[] = [];
  for (const name of names) {
    const mod = (await import(join(dir, name))) as Record<string, unknown>;
    defs.push(...collectDefsFromModule(mod));
  }
  return { files: names, defs };
}

/** Return duplicate numeric codes, or an empty array if all unique. */
export function findDuplicateCodes(defs: readonly OkeErrorDefinition[]): readonly number[] {
  const seen = new Set<number>();
  const dupes: number[] = [];
  for (const def of defs) {
    if (seen.has(def.code)) dupes.push(def.code);
    else seen.add(def.code);
  }
  return dupes;
}

/** Return defs whose code falls outside `OKE_ERROR_RANGES[domain]`. */
export function findOutOfRangeDefs(
  defs: readonly OkeErrorDefinition[],
): readonly OkeErrorDefinition[] {
  const bad: OkeErrorDefinition[] = [];
  for (const def of defs) {
    const range = OKE_ERROR_RANGES[def.domain as OkeErrorDomain];
    if (!range) {
      bad.push(def);
      continue;
    }
    const [lo, hi] = range;
    if (def.code < lo || def.code > hi) bad.push(def);
  }
  return bad;
}

/** Throw if any code is duplicated. */
export function assertUniqueCodes(defs: readonly OkeErrorDefinition[]): void {
  const dupes = findDuplicateCodes(defs);
  if (dupes.length > 0) {
    throw new Error(`Duplicate OKE error codes: ${dupes.join(", ")}`);
  }
}

/** Throw if any code is outside its declared domain range. */
export function assertCodesInDomainRanges(defs: readonly OkeErrorDefinition[]): void {
  const bad = findOutOfRangeDefs(defs);
  if (bad.length > 0) {
    const detail = bad.map((d) => `OKE${d.code} domain=${d.domain}`).join("; ");
    throw new Error(`OKE error codes outside domain range: ${detail}`);
  }
}
