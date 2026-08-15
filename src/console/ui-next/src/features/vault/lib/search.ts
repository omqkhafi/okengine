/**
 * Deep vault search — GitHub-style operators over contracts (console §9.8).
 *
 * Free text matches name, description, fingerprints, readers, winner, and
 * config cleartext. Operators AND together; unknown `key:value` stays text.
 */

import { contractPosture, isRotateCadence, type VaultIsFilter } from "./posture.ts";
import type { VaultRecord, VaultResolutionSource } from "./types.ts";

/** Operator kinds the parser understands. */
export type VaultSearchTokenKind =
  | "is"
  | "kind"
  | "from"
  | "reader"
  | "fp"
  | "has"
  | "rotate"
  | "text";

/** One parsed token. */
export type VaultSearchToken =
  | { readonly kind: "is"; readonly value: VaultIsFilter }
  | { readonly kind: "kind"; readonly value: "secret" | "config" }
  | { readonly kind: "from"; readonly value: string }
  | { readonly kind: "reader"; readonly value: string }
  | { readonly kind: "fp"; readonly value: string }
  | { readonly kind: "has"; readonly value: VaultHasFilter }
  | { readonly kind: "rotate"; readonly value: string }
  | { readonly kind: "text"; readonly value: string };

/** `has:` values. */
export type VaultHasFilter = "readers" | "rotate" | "blast" | "shared";

/** Parsed query. */
export interface VaultSearchQuery {
  readonly tokens: readonly VaultSearchToken[];
  readonly raw: string;
}

/** Operator help shown in the search popover. */
export interface VaultSearchSuggestion {
  readonly token: string;
  readonly label: string;
}

const IS_VALUES = new Set<VaultIsFilter>([
  "unset",
  "set",
  "dormant",
  "blast",
  "shared",
  "overdue",
  "unread",
  "healthy",
]);

const KIND_VALUES = new Set<"secret" | "config">(["secret", "config"]);
const HAS_VALUES = new Set<VaultHasFilter>(["readers", "rotate", "blast", "shared"]);

/** Catalog of operators for the empty-query popover. */
export const VAULT_SEARCH_CATALOG: readonly VaultSearchSuggestion[] = [
  { token: "is:unset", label: "No value in this environment" },
  { token: "is:set", label: "Has a fingerprint or config value" },
  { token: "is:blast", label: "In-flight durable runs hold this secret" },
  { token: "is:shared", label: "Fingerprint matches another environment" },
  { token: "is:dormant", label: "Unread for 90 days, or never" },
  { token: "is:overdue", label: "Last read older than rotate — never-read counts" },
  { token: "is:healthy", label: "Set, no blast, no shared, not dormant" },
  { token: "kind:secret", label: "Sensitive contracts only" },
  { token: "kind:config", label: "Non-sensitive config only" },
  { token: "from:.env.local", label: "Winner is .env.local" },
  { token: "from:driver", label: "Winner is the vault backend (built-in / managed / memory)" },
  { token: "has:readers", label: "At least one Flow declares a read" },
  { token: "has:rotate", label: "Contract declares a rotate cadence" },
  { token: "rotate:never", label: "No rotate cadence (stable secret)" },
  { token: "reader:", label: "Flow id contains…" },
  { token: "fp:", label: "Fingerprint contains…" },
];

const RESOLUTION_SOURCES: readonly VaultResolutionSource[] = [
  "driver",
  "process.env",
  ".env.local",
  "dev-fallback",
];

/**
 * Split on whitespace; quoted spans stay one token.
 *
 * @param raw - Query string
 */
export function tokenizeVaultSearch(raw: string): readonly string[] {
  const out: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw)) !== null) {
    const token = match[1] ?? match[2] ?? "";
    if (token.length > 0) out.push(token);
  }
  return out;
}

/**
 * Parse a vault search string into typed tokens.
 *
 * @param raw - Query string
 */
export function parseVaultSearch(raw: string): VaultSearchQuery {
  const tokens: VaultSearchToken[] = [];
  for (const part of tokenizeVaultSearch(raw)) {
    const parsed = parseOperator(part);
    if (parsed) tokens.push(parsed);
    else tokens.push({ kind: "text", value: part });
  }
  return { tokens, raw };
}

/**
 * Reconstruct a query string from tokens (operators first, then text).
 *
 * @param tokens - Parsed tokens
 */
export function formatVaultSearch(tokens: readonly VaultSearchToken[]): string {
  const ops: string[] = [];
  const text: string[] = [];
  for (const token of tokens) {
    if (token.kind === "text") {
      text.push(needsQuotes(token.value) ? `"${token.value}"` : token.value);
      continue;
    }
    ops.push(`${token.kind}:${token.value}`);
  }
  return [...ops, ...text].join(" ").trim();
}

/**
 * Toggle an `is:` filter in a raw query.
 *
 * @param raw - Current query
 * @param value - Filter to toggle
 */
export function toggleIsToken(raw: string, value: VaultIsFilter): string {
  const parsed = parseVaultSearch(raw);
  const has = parsed.tokens.some((t) => t.kind === "is" && t.value === value);
  const next = has
    ? parsed.tokens.filter((t) => !(t.kind === "is" && t.value === value))
    : [...parsed.tokens, { kind: "is", value } as const];
  return formatVaultSearch(next);
}

/**
 * Whether the query already includes this `is:` filter.
 *
 * @param raw - Current query
 * @param value - Filter
 */
export function hasIsToken(raw: string, value: VaultIsFilter): boolean {
  return parseVaultSearch(raw).tokens.some((t) => t.kind === "is" && t.value === value);
}

/**
 * Match a contract against a parsed query. Empty query matches all.
 *
 * @param row - Vault row
 * @param query - Parsed query
 * @param now - Clock (epoch ms)
 */
export function matchesVaultSearch(
  row: VaultRecord,
  query: VaultSearchQuery,
  now: number,
): boolean {
  if (query.tokens.length === 0) return true;
  const posture = contractPosture(row, now);
  for (const token of query.tokens) {
    if (!matchToken(row, token, posture)) return false;
  }
  return true;
}

/**
 * Suggestions for the current trailing token (or the full catalog).
 *
 * @param raw - Query string
 * @param secrets - Rows used to suggest readers / fingerprints
 */
export function vaultSearchSuggestions(
  raw: string,
  secrets: readonly VaultRecord[],
): readonly VaultSearchSuggestion[] {
  const trailing = trailingToken(raw);
  if (trailing === null) return VAULT_SEARCH_CATALOG;

  const lower = trailing.toLowerCase();
  if (lower.startsWith("is:") || lower === "is") {
    return filterCatalog(
      VAULT_SEARCH_CATALOG.filter((s) => s.token.startsWith("is:")),
      trailing,
    );
  }
  if (lower.startsWith("kind:") || lower === "kind") {
    return filterCatalog(
      [
        { token: "kind:secret", label: "Sensitive contracts only" },
        { token: "kind:config", label: "Non-sensitive config only" },
      ],
      trailing,
    );
  }
  if (lower.startsWith("from:") || lower === "from") {
    return filterCatalog(
      RESOLUTION_SOURCES.map((source) => ({
        token: `from:${source}`,
        label:
          source === "driver"
            ? "Winner is the vault backend (built-in / managed / memory)"
            : `Winner is ${source}`,
      })),
      trailing,
    );
  }
  if (lower.startsWith("has:") || lower === "has") {
    return filterCatalog(
      VAULT_SEARCH_CATALOG.filter((s) => s.token.startsWith("has:")),
      trailing,
    );
  }
  if (lower.startsWith("reader:") || lower === "reader") {
    const needle = lower.startsWith("reader:") ? lower.slice("reader:".length) : "";
    const ids = new Set<string>();
    for (const row of secrets) {
      for (const reader of row.readers) {
        if (needle.length === 0 || reader.toLowerCase().includes(needle)) ids.add(reader);
      }
    }
    return [...ids].slice(0, 8).map((id) => ({
      token: `reader:${id}`,
      label: "Flow that reads this contract",
    }));
  }
  if (lower.startsWith("fp:") || lower === "fp") {
    const needle = lower.startsWith("fp:") ? lower.slice("fp:".length) : "";
    const fps = new Set<string>();
    for (const row of secrets) {
      for (const fp of Object.values(row.fingerprints)) {
        if (needle.length === 0 || fp.toLowerCase().includes(needle)) fps.add(fp);
      }
      if (
        row.fingerprint &&
        (needle.length === 0 || row.fingerprint.toLowerCase().includes(needle))
      ) {
        fps.add(row.fingerprint);
      }
    }
    return [...fps].slice(0, 8).map((fp) => ({
      token: `fp:${fp}`,
      label: "Exact fingerprint",
    }));
  }
  if (lower.startsWith("rotate:") || lower === "rotate") {
    return filterCatalog(
      [
        { token: "rotate:due", label: "Last read older than rotate — never-read counts" },
        { token: "has:rotate", label: "Contract declares a rotate cadence" },
        { token: "rotate:never", label: "No rotate cadence (stable secret)" },
      ],
      trailing,
    );
  }

  const q = lower;
  return VAULT_SEARCH_CATALOG.filter(
    (s) => s.token.includes(q) || s.label.toLowerCase().includes(q),
  );
}

/**
 * Replace the trailing token with `next`, or append when the query ends in space.
 *
 * @param raw - Current query
 * @param next - Token to apply
 */
export function applySearchSuggestion(raw: string, next: string): string {
  if (raw.length === 0 || /\s$/.test(raw)) {
    return `${raw}${next} `.replace(/^\s+/, "");
  }
  const lastSpace = raw.lastIndexOf(" ");
  if (lastSpace < 0) return `${next} `;
  return `${raw.slice(0, lastSpace + 1)}${next} `;
}

function parseOperator(part: string): VaultSearchToken | null {
  if (part.startsWith('"')) return null;
  const colon = part.indexOf(":");
  if (colon <= 0) return null;
  const key = part.slice(0, colon).toLowerCase();
  const value = part.slice(colon + 1);
  if (value.length === 0) return null;

  if (key === "is") {
    const v = value.toLowerCase();
    if (IS_VALUES.has(v as VaultIsFilter)) return { kind: "is", value: v as VaultIsFilter };
    if (KIND_VALUES.has(v as "secret" | "config")) {
      return { kind: "kind", value: v as "secret" | "config" };
    }
    return null;
  }
  if (key === "kind") {
    const v = value.toLowerCase();
    if (KIND_VALUES.has(v as "secret" | "config")) {
      return { kind: "kind", value: v as "secret" | "config" };
    }
    return null;
  }
  if (key === "from") return { kind: "from", value: value.toLowerCase() };
  if (key === "reader") return { kind: "reader", value: value.toLowerCase() };
  if (key === "fp") return { kind: "fp", value: value.toLowerCase() };
  if (key === "has") {
    const v = value.toLowerCase();
    if (HAS_VALUES.has(v as VaultHasFilter)) return { kind: "has", value: v as VaultHasFilter };
    return null;
  }
  if (key === "rotate") {
    const v = value.toLowerCase();
    if (v === "due") return { kind: "is", value: "overdue" };
    return { kind: "rotate", value: v };
  }
  return null;
}

function matchToken(
  row: VaultRecord,
  token: VaultSearchToken,
  posture: ReturnType<typeof contractPosture>,
): boolean {
  switch (token.kind) {
    case "is":
      return posture[token.value];
    case "kind":
      return row.kind === token.value;
    case "from":
      return (row.winner ?? "").toLowerCase() === token.value;
    case "reader":
      return row.readers.some((id) => id.toLowerCase().includes(token.value));
    case "fp":
      return fingerprintHaystack(row).some((fp) => fp.includes(token.value));
    case "has":
      if (token.value === "readers") return row.readers.length > 0;
      if (token.value === "rotate") return isRotateCadence(row.rotate);
      if (token.value === "blast") return row.blastRadius.count > 0;
      return row.sharedFingerprintEnvs.length > 0;
    case "rotate":
      if (token.value === "never") {
        return row.kind === "secret" && !isRotateCadence(row.rotate);
      }
      return (row.rotate ?? "").toLowerCase() === token.value;
    case "text":
      return textHaystack(row).includes(token.value.toLowerCase());
  }
}

function fingerprintHaystack(row: VaultRecord): readonly string[] {
  const out = Object.values(row.fingerprints).map((fp) => fp.toLowerCase());
  if (row.fingerprint) out.push(row.fingerprint.toLowerCase());
  return out;
}

function textHaystack(row: VaultRecord): string {
  const parts = [
    row.name,
    row.description ?? "",
    row.winner ?? "",
    row.kind,
    ...row.readers,
    ...Object.keys(row.fingerprints),
    ...Object.values(row.fingerprints),
    row.fingerprint ?? "",
    row.sensitive ? "" : (row.cleartext ?? ""),
  ];
  return parts.join("\n").toLowerCase();
}

function needsQuotes(value: string): boolean {
  return /\s/.test(value);
}

function trailingToken(raw: string): string | null {
  if (raw.length === 0 || /\s$/.test(raw)) return null;
  const parts = tokenizeVaultSearch(raw);
  return parts[parts.length - 1] ?? null;
}

function filterCatalog(
  items: readonly VaultSearchSuggestion[],
  trailing: string,
): readonly VaultSearchSuggestion[] {
  const q = trailing.toLowerCase();
  return items.filter(
    (s) => s.token.toLowerCase().startsWith(q) || s.token.toLowerCase().includes(q),
  );
}
