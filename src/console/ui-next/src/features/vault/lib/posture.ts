/**
 * Vault contract posture — risk flags derived from list rows (console §9.8).
 *
 * Never invents timestamps the server did not send. `overdue` uses the
 * contract `rotate` hint against `lastReadAt` (the only recency signal).
 */

import { DORMANT_MS } from "./dormant.ts";
import type { VaultRecord } from "./types.ts";

/** `is:` filters that map 1:1 onto {@link VaultPosture} booleans. */
export type VaultIsFilter =
  | "unset"
  | "set"
  | "dormant"
  | "blast"
  | "shared"
  | "overdue"
  | "unread"
  | "healthy";

/** Risk chips shown in the posture strip (worst-first). */
export type VaultRiskId = "blast" | "unset" | "overdue" | "shared" | "dormant";

/** Per-contract posture flags. */
export interface VaultPosture {
  readonly unset: boolean;
  readonly set: boolean;
  readonly blast: boolean;
  readonly shared: boolean;
  readonly dormant: boolean;
  readonly overdue: boolean;
  readonly unread: boolean;
  readonly healthy: boolean;
  readonly risks: readonly VaultRiskId[];
  readonly primary: VaultRiskId | "healthy" | "config";
}

/** Vault-wide counts for the posture strip. */
export interface VaultPostureSummary {
  readonly total: number;
  readonly secrets: number;
  readonly config: number;
  readonly unset: number;
  readonly blast: number;
  readonly shared: number;
  readonly dormant: number;
  readonly overdue: number;
  readonly healthy: number;
}

/** One clickable facet in the strip. */
export interface VaultPostureFacet {
  readonly id: VaultRiskId;
  readonly label: string;
  readonly token: VaultIsFilter;
  readonly tone: "danger" | "warn" | "neutral";
}

/** Facets in scan order. */
export const VAULT_POSTURE_FACETS: readonly VaultPostureFacet[] = [
  { id: "blast", label: "Blast", token: "blast", tone: "danger" },
  { id: "unset", label: "Unset", token: "unset", tone: "warn" },
  { id: "overdue", label: "Overdue", token: "overdue", tone: "warn" },
  { id: "shared", label: "Shared", token: "shared", tone: "warn" },
  { id: "dormant", label: "Dormant", token: "dormant", tone: "neutral" },
];

const RISK_ORDER: readonly VaultRiskId[] = ["blast", "unset", "overdue", "shared", "dormant"];

/**
 * Parse a contract rotate hint (`90d`, `12h`) to milliseconds.
 * Returns `0` when the string is not a duration.
 *
 * @param rotate - Contract `rotate` option
 */
export function parseRotateHintMs(rotate: string | undefined): number {
  if (!rotate) return 0;
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(rotate.trim());
  if (!match) return 0;
  const n = Number(match[1]);
  switch (match[2]) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    case "d":
      return n * 86_400_000;
    default:
      return 0;
  }
}

const NEVER_ROTATE = new Set(["never", "none", "off"]);

/**
 * Whether `rotate` is a cadence (`90d`), not `never` / omitted.
 *
 * @param rotate - Contract `rotate` option
 */
export function isRotateCadence(rotate: string | undefined): boolean {
  return parseRotateHintMs(rotate) > 0;
}

/**
 * Chip for the rotate policy. Cadence stays `90d`; `never` / omit is
 * `no rotate` so a stable secret is not silent.
 *
 * @param rotate - Contract `rotate` option
 */
export function rotatePolicyLabel(rotate: string | undefined): string {
  if (isRotateCadence(rotate)) return rotate!.trim();
  const raw = rotate?.trim().toLowerCase() ?? "";
  if (raw.length === 0 || NEVER_ROTATE.has(raw)) return "no rotate";
  return rotate!.trim();
}

/**
 * Whether this contract currently has a value in the active environment.
 *
 * @param row - Vault row
 */
export function isContractSet(row: VaultRecord): boolean {
  if (row.sensitive) return row.fingerprint != null && row.fingerprint.length > 0;
  return row.cleartext != null && row.cleartext.length > 0;
}

/**
 * Per-contract posture.
 *
 * @param row - Vault row
 * @param now - Clock (epoch ms)
 */
export function contractPosture(row: VaultRecord, now: number): VaultPosture {
  const set = isContractSet(row);
  const unset = !set;
  const blast = row.blastRadius.count > 0;
  const shared = row.sharedFingerprintEnvs.length > 0;
  const unread = row.lastReadAt == null;
  const dormant =
    row.kind === "secret" &&
    (unread || (row.lastReadAt != null && now - row.lastReadAt >= DORMANT_MS));
  const rotateMs = parseRotateHintMs(row.rotate);
  const overdue =
    row.kind === "secret" &&
    set &&
    rotateMs > 0 &&
    (unread || (row.lastReadAt != null && now - row.lastReadAt >= rotateMs));

  const risks: VaultRiskId[] = [];
  if (blast) risks.push("blast");
  if (unset) risks.push("unset");
  if (overdue) risks.push("overdue");
  if (shared) risks.push("shared");
  if (dormant) risks.push("dormant");

  const healthy = set && !blast && !shared && !dormant && !overdue;
  const primary: VaultPosture["primary"] =
    row.kind === "config" && !unset && !blast && !shared
      ? "config"
      : (RISK_ORDER.find((id) => risks.includes(id)) ?? "healthy");

  return { unset, set, blast, shared, dormant, overdue, unread, healthy, risks, primary };
}

/**
 * Aggregate posture counts.
 *
 * @param rows - Vault rows
 * @param now - Clock (epoch ms)
 */
export function summarizePosture(rows: readonly VaultRecord[], now: number): VaultPostureSummary {
  let secrets = 0;
  let config = 0;
  let unset = 0;
  let blast = 0;
  let shared = 0;
  let dormant = 0;
  let overdue = 0;
  let healthy = 0;
  for (const row of rows) {
    if (row.kind === "secret") secrets += 1;
    else config += 1;
    const p = contractPosture(row, now);
    if (p.unset) unset += 1;
    if (p.blast) blast += 1;
    if (p.shared) shared += 1;
    if (p.dormant) dormant += 1;
    if (p.overdue) overdue += 1;
    if (p.healthy) healthy += 1;
  }
  return {
    total: rows.length,
    secrets,
    config,
    unset,
    blast,
    shared,
    dormant,
    overdue,
    healthy,
  };
}

/**
 * Relative age for last-read / seal timestamps.
 *
 * @param at - Epoch ms
 * @param now - Clock
 */
export function formatRelativeTime(at: number, now: number): string {
  const delta = Math.max(0, now - at);
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  const days = Math.floor(delta / 86_400_000);
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

/**
 * Short label for a posture primary.
 *
 * @param primary - Worst risk or healthy/config
 */
export function postureLabel(primary: VaultPosture["primary"]): string {
  switch (primary) {
    case "blast":
      return "blast";
    case "unset":
      return "unset";
    case "overdue":
      return "overdue";
    case "shared":
      return "shared";
    case "dormant":
      return "dormant";
    case "config":
      return "config";
    case "healthy":
      return "set";
  }
}

/**
 * Hover copy for a posture chip. Overdue names the rotate window.
 *
 * @param primary - Worst risk or healthy/config
 * @param rotate - Contract rotate hint (`90d`)
 */
export function postureHint(primary: VaultPosture["primary"], rotate?: string): string {
  switch (primary) {
    case "blast":
      return "In-flight durable runs hold this secret";
    case "unset":
      return "No value in this environment";
    case "overdue":
      return rotate
        ? `Last read older than rotate ${rotate} — never-read counts`
        : "Last read older than the rotate hint — never-read counts";
    case "shared":
      return "Fingerprint matches another environment";
    case "dormant":
      return "Unread for 90 days, or never";
    case "config":
      return "vault.config — shown in the clear";
    case "healthy":
      return "Set, no blast, no shared, not dormant";
  }
}
