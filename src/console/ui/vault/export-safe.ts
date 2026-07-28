/**
 * Export / log safety — Vault panel payloads must never carry secret values.
 */

import type { VaultRecord } from "./types.ts";

/**
 * Project a row for export/clipboard — fingerprints only for secrets;
 * config cleartext is allowed.
 *
 * @param row - Vault row
 */
export function exportSafeRow(row: VaultRecord): Record<string, unknown> {
  return {
    name: row.name,
    kind: row.kind,
    sensitive: row.sensitive,
    description: row.description ?? null,
    rotate: row.rotate ?? null,
    fingerprints: { ...row.fingerprints },
    fingerprint: row.fingerprint,
    cleartext: row.sensitive ? null : row.cleartext,
    winner: row.winner,
    resolution: row.resolution.map((s) => ({ ...s })),
    readers: [...row.readers],
    blastRadius: {
      count: row.blastRadius.count,
      longestWakeAt: row.blastRadius.longestWakeAt,
      longestOutstandingMs: row.blastRadius.longestOutstandingMs,
      runIds: [...row.blastRadius.runIds],
    },
    lastReadAt: row.lastReadAt,
    sharedFingerprintEnvs: [...row.sharedFingerprintEnvs],
  };
}

/**
 * Serialize list for export — never includes secret cleartext.
 *
 * @param rows - Vault rows
 */
export function exportSafeList(rows: readonly VaultRecord[]): string {
  return JSON.stringify(
    rows.map((r) => exportSafeRow(r)),
    null,
    2,
  );
}

/**
 * Assert a serialized payload does not contain known secret values.
 *
 * @param payload - Serialized text
 * @param knownSecrets - Cleartext secrets that must not appear
 */
export function assertExportHasNoSecrets(payload: string, knownSecrets: readonly string[]): void {
  for (const secret of knownSecrets) {
    if (secret.length > 0 && payload.includes(secret)) {
      throw new Error("vault export leaked a secret value");
    }
  }
}
