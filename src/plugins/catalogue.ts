/**
 * Core plugin catalogue (console §9.15).
 *
 * State derivation (binding decision — keep four-applications + Console aligned):
 *
 * - `auth` · `console` · `rate-limit` → **on** iff present via `.plug()`
 *   (Manifest `plugins` / registry install).
 * - `tenancy` → **on** iff `oke.config.ts` has `tenancy: {…}` (or Manifest
 *   `tenancy` was reconciled from that section).
 * - `privacy` → **on** iff `oke.config.ts` has a `privacy` block **or**
 *   top-level `runs.redact` (retention redaction map). Not a separate `.plug()`.
 */

import type { Manifest } from "../manifest/types.ts";

/** How CORE plugin on/off is derived. */
export type CoreStateSource = "plug" | "config";

/** One CORE catalogue entry. */
export interface CorePluginSpec {
  readonly id: string;
  readonly stateFrom: CoreStateSource;
  /** Short catalogue blurb (feature discovery when off). */
  readonly summary: string;
}

/**
 * Canonical CORE catalogue — always listed in the Plugins panel.
 */
export const CORE_PLUGINS: readonly CorePluginSpec[] = [
  {
    id: "auth",
    stateFrom: "plug",
    summary: "Hybrid session, two planes, roles as data",
  },
  {
    id: "console",
    stateFrom: "plug",
    summary: "Operator Console on :6533",
  },
  {
    id: "rate-limit",
    stateFrom: "plug",
    summary: "Attachment-scoped request rate limits",
  },
  {
    id: "tenancy",
    stateFrom: "config",
    summary: "Multi-tenant isolation (row · schema · database)",
  },
  {
    id: "privacy",
    stateFrom: "config",
    summary: "PII classification, redact, export/erase tooling",
  },
] as const;

/** Config shape inspected for tenancy / privacy state (loose). */
export interface PluginConfigProbe {
  readonly tenancy?: unknown;
  readonly privacy?: unknown;
  readonly runs?: { readonly redact?: unknown };
}

/**
 * Whether a CORE plugin is on given Manifest + config probe.
 *
 * @param id - Core plugin id
 * @param manifest - Live Manifest
 * @param config - Loaded oke.config (or probe)
 * @param pluggedNames - Names present via `.plug()` / Manifest.plugins
 */
export function isCorePluginOn(
  id: string,
  manifest: Manifest | null,
  config: PluginConfigProbe | null | undefined,
  pluggedNames: ReadonlySet<string>,
): boolean {
  const spec = CORE_PLUGINS.find((p) => p.id === id);
  if (!spec) return pluggedNames.has(id);
  if (spec.stateFrom === "plug") return pluggedNames.has(id);
  if (id === "tenancy") return isTenancyConfigured(manifest, config);
  if (id === "privacy") return isPrivacyConfigured(config);
  return false;
}

/**
 * Tenancy is on when config or Manifest carries a tenancy section.
 *
 * @param manifest - Manifest
 * @param config - Config probe
 */
export function isTenancyConfigured(
  manifest: Manifest | null,
  config: PluginConfigProbe | null | undefined,
): boolean {
  if (config?.tenancy != null) return true;
  if (manifest?.tenancy != null) return true;
  return false;
}

/**
 * Privacy is on when config has `privacy` or `runs.redact`.
 *
 * @param config - Config probe
 */
export function isPrivacyConfigured(
  config: PluginConfigProbe | null | undefined,
): boolean {
  if (config?.privacy != null) return true;
  if (config?.runs?.redact != null) return true;
  return false;
}
