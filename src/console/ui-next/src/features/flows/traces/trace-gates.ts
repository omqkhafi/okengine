/**
 * Resolve Gate element rows for the trace detail Sheet from run.gates + Manifest.
 */

import {
  DashboardSpeed01Icon,
  Flag01Icon,
  Key01Icon,
  SecurityCheckIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import type { Manifest } from "../../../../../../manifest/types.ts";
import type { ElementHugeIcon } from "@/lib/element-icons.ts";

/** Chip label — graph vocabulary: policy · scope · rate · flag · public. */
export type GateChipKind = "policy" | "scope" | "rate" | "flag" | "public";

/** One gate evaluated on a run, enriched from Manifest when present. */
export type TraceGateInfo = {
  /** Gate name from the run ledger. */
  readonly name: string;
  /** Manifest kind, or `null` when undeclared. */
  readonly kind: "policy" | "rate" | null;
  /** Display kind — `scope` when `scopes` are set. */
  readonly variant: GateChipKind | null;
  /** Manifest description, or `null` when undeclared. */
  readonly description: string | null;
};

/** Distinct glyph per Gate type (same as RLS catalog + graph kinds). */
export const GATE_CHIP_ICONS: Readonly<Record<GateChipKind, ElementHugeIcon>> = {
  policy: SecurityCheckIcon,
  scope: Key01Icon,
  rate: DashboardSpeed01Icon,
  flag: Flag01Icon,
  public: UserIcon,
};

/**
 * Chip kind: rate / flag / public by name; policy with scopes is `scope`.
 *
 * @param name - Gate name
 * @param kind - Manifest `kind`
 * @param scopes - Manifest `scopes`
 */
export function gateChipKind(
  name: string,
  kind: "policy" | "rate" | undefined,
  scopes: readonly string[] | undefined,
): GateChipKind | null {
  if (kind === "rate" || name.startsWith("rate:")) return "rate";
  if (name.startsWith("flag:")) return "flag";
  if (name === "public") return "public";
  if ((scopes?.length ?? 0) > 0) return "scope";
  if (kind === "policy") return "policy";
  return null;
}

/**
 * Icon for a Gate chip kind. Undeclared falls back to the Gate element shield.
 *
 * @param variant - Display kind
 */
export function gateChipIcon(variant: GateChipKind | null): ElementHugeIcon {
  return variant ? GATE_CHIP_ICONS[variant] : SecurityCheckIcon;
}

/**
 * Project `run.gates` into display rows — Manifest fills kind/description.
 *
 * Unknown names still appear (ledger is source of truth).
 *
 * @param gateNames - Gate names from the projected run
 * @param manifest - Current Manifest snapshot (optional)
 */
export function traceGateInfos(
  gateNames: readonly string[],
  manifest: Manifest | null | undefined,
): readonly TraceGateInfo[] {
  const defs = manifest?.gates;
  return gateNames.map((name) => {
    const def = defs?.[name];
    return {
      name,
      kind: def?.kind ?? null,
      variant: gateChipKind(name, def?.kind, def?.scopes),
      description: def?.description ?? null,
    };
  });
}
