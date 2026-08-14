/**
 * KV browse metadata — remaining TTL and serialized value size.
 */

/**
 * UTF-8 byte length of a JSON-serialized KV value.
 *
 * @param value - Raw cell
 */
export function kvValueSizeBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
  } catch {
    return 0;
  }
}

/**
 * Compact remaining-TTL label for the KV grid (`45s`, `12m`, `2h`, `3d`).
 *
 * @param ms - Remaining milliseconds, or null when the key has no expiry
 */
export function formatKvTtl(ms: unknown): string {
  if (typeof ms === "string") {
    const trimmed = ms.trim();
    return trimmed === "" ? "—" : trimmed;
  }
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  if (ms <= 0) return "0s";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

/**
 * Parse a TTL cell draft. Empty / `—` / `none` clears expiry.
 * Valid duration strings (`30m`, `1h`) are returned as-is. Invalid → `undefined`.
 *
 * @param text - Editor draft
 */
export function parseKvTtlDraft(text: string): string | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "—" || trimmed === "none") return null;
  if (!/^(\d+)(ms|s|m|h|d)$/.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Compact byte-size label (`128 B`, `1.4 KB`, `2 MB`).
 *
 * @param bytes - UTF-8 byte length
 */
export function formatByteSize(bytes: unknown): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return kb < 10 ? `${kb.toFixed(1)} KB` : `${Math.round(kb)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}
