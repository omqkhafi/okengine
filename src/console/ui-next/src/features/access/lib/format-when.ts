/**
 * Relative timestamps for Access keys (create / last used / expiry).
 */

/**
 * Age or remaining time of an Access timestamp, or `never` when null.
 *
 * Past → `5m ago`. Future → `in 30d`. Sub-minute → `just now`.
 *
 * @param at - Epoch ms, or null
 * @param now - Clock
 */
export function formatAccessWhen(at: number | null, now: number): string {
  if (at == null) return "never";
  const delta = at - now;
  if (Math.abs(delta) < 60_000) return "just now";
  const abs = Math.abs(delta);
  const unit = unitLabel(abs);
  return delta < 0 ? `${unit} ago` : `in ${unit}`;
}

/**
 * Remaining life of an expiry, or `expired` once the clock passes it.
 *
 * @param at - Epoch ms, or null
 * @param now - Clock
 */
export function formatAccessExpiry(at: number | null, now: number): string {
  if (at == null) return "never";
  if (at <= now) return "expired";
  return formatAccessWhen(at, now);
}

function unitLabel(abs: number): string {
  if (abs < 3_600_000) return `${Math.floor(abs / 60_000)}m`;
  if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)}h`;
  const days = Math.floor(abs / 86_400_000);
  if (days < 100) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

const DAY_MS = 86_400_000;

/** Expiry presets on the create sheet. */
export type AccessExpiryChoice = "never" | "30d" | "90d" | "custom";

/**
 * Parse a Clock duration (`7d`, `12h`, `30m`). Returns `0` when invalid.
 *
 * @param raw - Duration string
 */
export function parseAccessDurationMs(raw: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(raw.trim());
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
      return n * DAY_MS;
    default:
      return 0;
  }
}

/**
 * Epoch ms for a create-sheet expiry choice.
 *
 * @param choice - Preset or custom
 * @param now - Clock
 * @param custom - Duration when {@link AccessExpiryChoice} is `custom`
 */
export function accessExpiresAt(
  choice: AccessExpiryChoice,
  now: number,
  custom = "",
): number | null {
  if (choice === "never") return null;
  if (choice === "30d") return now + 30 * DAY_MS;
  if (choice === "90d") return now + 90 * DAY_MS;
  const ms = parseAccessDurationMs(custom);
  return ms > 0 ? now + ms : null;
}

const HOUR_MS = 3_600_000;

/**
 * Reconstruct an expiry choice from a stored timestamp.
 *
 * @param expiresAt - Epoch ms, or null
 * @param now - Clock
 */
export function accessExpiryFromAt(
  expiresAt: number | null,
  now: number,
): { readonly choice: AccessExpiryChoice; readonly custom: string } {
  if (expiresAt == null) return { choice: "never", custom: "" };
  const remaining = expiresAt - now;
  if (remaining <= 0) return { choice: "never", custom: "" };
  if (Math.abs(remaining - 30 * DAY_MS) < HOUR_MS) return { choice: "30d", custom: "" };
  if (Math.abs(remaining - 90 * DAY_MS) < HOUR_MS) return { choice: "90d", custom: "" };
  return { choice: "custom", custom: formatAccessDuration(remaining) };
}

/** Snap remaining life to 30d / 90d so weekly refresh does not shrink the window. */
const REFRESH_SNAP_MS = 7 * DAY_MS;

/**
 * Seed a Refresh sheet: snap remaining life to 30d / 90d. Expired or never
 * defaults to 90d. The secret is unchanged — only `expiresAt` moves.
 *
 * @param expiresAt - Epoch ms, or null
 * @param now - Clock
 */
export function accessRefreshExpiry(
  expiresAt: number | null,
  now: number,
): { readonly choice: AccessExpiryChoice; readonly custom: string } {
  if (expiresAt == null || expiresAt <= now) return { choice: "90d", custom: "" };
  const remaining = expiresAt - now;
  if (Math.abs(remaining - 30 * DAY_MS) <= REFRESH_SNAP_MS) return { choice: "30d", custom: "" };
  if (Math.abs(remaining - 90 * DAY_MS) <= REFRESH_SNAP_MS) return { choice: "90d", custom: "" };
  return { choice: "custom", custom: formatAccessDuration(remaining) };
}

/**
 * Clock duration for a remaining span (`7d` · `12h` · `30m`).
 *
 * @param ms - Remaining milliseconds
 */
export function formatAccessDuration(ms: number): string {
  if (ms <= 0) return "";
  if (ms >= DAY_MS && ms % DAY_MS === 0) return `${ms / DAY_MS}d`;
  if (ms >= HOUR_MS && ms % HOUR_MS === 0) return `${ms / HOUR_MS}h`;
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms >= DAY_MS) return `${Math.max(1, Math.round(ms / DAY_MS))}d`;
  if (ms >= HOUR_MS) return `${Math.max(1, Math.round(ms / HOUR_MS))}h`;
  return `${Math.max(1, Math.round(ms / 60_000))}m`;
}

/**
 * Parse `60 / 1m`. Empty is no limit.
 *
 * @param raw - Inspector-style rate
 */
export function parseAccessRateLimit(raw: string): { max: number; per: string } | null | undefined {
  const t = raw.trim();
  if (t.length === 0) return null;
  const match = /^(\d+)\s*\/\s*(\d+(?:ms|s|m|h|d))$/.exec(t);
  if (!match) return undefined;
  return { max: Number(match[1]), per: match[2]! };
}

/**
 * Format a stored rate for the edit field.
 *
 * @param rate - Stored limit
 */
export function formatAccessRateLimit(rate: { max: number; per: string } | null): string {
  return rate ? `${rate.max} / ${rate.per}` : "";
}

/** Clock units for the rate window. */
export const ACCESS_RATE_UNITS = ["s", "m", "h", "d", "ms"] as const;

/** One {@link ACCESS_RATE_UNITS} token. */
export type AccessRateUnit = (typeof ACCESS_RATE_UNITS)[number];

/** Default window unit — minutes. */
export const DEFAULT_ACCESS_RATE_UNIT: AccessRateUnit = "m";

/** Hover labels for {@link ACCESS_RATE_UNITS}. */
export const ACCESS_RATE_UNIT_LABELS: Readonly<Record<AccessRateUnit, string>> = {
  s: "Seconds",
  m: "Minutes",
  h: "Hours",
  d: "Days",
  ms: "Milliseconds",
};

/**
 * Parse max + window + unit. Both count fields empty is none.
 *
 * @param maxRaw - Hit count
 * @param countRaw - Window count
 * @param unit - Window unit
 */
export function parseAccessRateParts(
  maxRaw: string,
  countRaw: string,
  unit: AccessRateUnit,
): { max: number; per: string } | null | undefined {
  const maxT = maxRaw.trim();
  const countT = countRaw.trim();
  if (maxT.length === 0 && countT.length === 0) return null;
  if (maxT.length === 0 || countT.length === 0) return undefined;
  if (!/^\d+$/.test(maxT) || !/^\d+$/.test(countT)) return undefined;
  const max = Number(maxT);
  const count = Number(countT);
  if (max <= 0 || count <= 0) return undefined;
  const per = `${count}${unit}`;
  if (parseAccessDurationMs(per) <= 0) return undefined;
  return { max, per };
}

/**
 * Split a stored `1m` window into count + unit.
 *
 * @param per - Stored window
 */
export function splitAccessRatePer(per: string): {
  readonly count: string;
  readonly unit: AccessRateUnit;
} {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(per.trim());
  if (!match) return { count: "", unit: DEFAULT_ACCESS_RATE_UNIT };
  return { count: match[1]!, unit: match[2] as AccessRateUnit };
}

/** Kind of a valid allow entry. */
export type AccessAllowKind = "ip" | "host";

/**
 * Classify a stored or draft allow entry. `null` is junk.
 *
 * @param raw - IP, hostname, or URL
 */
export function classifyAccessAllowEntry(raw: string): AccessAllowKind | null {
  const part = normalizeAllowlistPart(raw);
  if (part.length === 0) return null;
  if (isAllowIp(part)) return "ip";
  if (isAllowHost(part)) return "host";
  return null;
}

/**
 * Split an allowlist field on commas or whitespace. Drops invalid parts.
 *
 * @param raw - Field value
 */
export function parseAccessAllowlist(raw: string): readonly string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const chunk of raw.split(/[\s,]+/)) {
    const part = normalizeAllowlistPart(chunk);
    if (part.length === 0 || seen.has(part)) continue;
    if (classifyAccessAllowEntry(part) == null) continue;
    seen.add(part);
    next.push(part);
  }
  return next;
}

function normalizeAllowlistPart(raw: string): string {
  let part = raw.trim().toLowerCase();
  part = part.replace(/^https?:\/\//, "");
  if (part.startsWith("[") && part.includes("]")) {
    const end = part.indexOf("]");
    const inner = part.slice(1, end);
    const rest = part.slice(end + 1);
    part = rest.startsWith(":") || rest.startsWith("/") ? inner : `${inner}${rest}`;
  }
  const slash = part.indexOf("/");
  if (slash >= 0) part = part.slice(0, slash);
  if (part.endsWith(".")) part = part.slice(0, -1);
  return part;
}

function isAllowIp(entry: string): boolean {
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(entry)) {
    return entry.split(".").every((octet) => Number(octet) <= 255);
  }
  if (!entry.includes(":")) return false;
  if (!/^[0-9a-f:]+$/.test(entry)) return false;
  if (entry.split("::").length > 2) return false;
  return entry.split(":").filter((part) => part.length > 0).length >= 1;
}

function isAllowHost(entry: string): boolean {
  if (entry === "localhost") return true;
  if (entry.length > 253 || entry.includes(":")) return false;
  const labels = entry.split(".");
  if (labels.length < 2) return false;
  return labels.every((label, index) => {
    if (label.length === 0 || label.length > 63) return false;
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) return false;
    if (index === labels.length - 1 && !/^[a-z]{2,63}$/.test(label)) return false;
    return true;
  });
}
