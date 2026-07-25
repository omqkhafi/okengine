/**
 * Vault panel types (console §9.8).
 */

/** Resolution layer id — matches VaultRuntime sources. */
export type VaultResolutionSource =
  | "process.env"
  | ".env.local"
  | ".env.stack"
  | "driver"
  | "dev-fallback";

/** One step in the full resolution chain. */
export interface VaultResolutionStep {
  readonly source: VaultResolutionSource;
  readonly present: boolean;
  readonly won: boolean;
}

/** Journal-queried rotation blast radius. */
export interface VaultBlastRadius {
  readonly count: number;
  readonly longestWakeAt: number | null;
  readonly longestOutstandingMs: number | null;
  readonly runIds: readonly string[];
}

/** One vault contract in the operator list. */
export interface VaultRecord {
  readonly name: string;
  readonly kind: "secret" | "config";
  readonly sensitive: boolean;
  readonly description?: string;
  readonly rotate?: string;
  readonly fingerprints: Readonly<Record<string, string>>;
  readonly fingerprint: string | null;
  readonly cleartext: string | null;
  readonly winner: VaultResolutionSource | null;
  readonly resolution: readonly VaultResolutionStep[];
  readonly readers: readonly string[];
  readonly blastRadius: VaultBlastRadius;
  readonly lastReadAt: number | null;
  readonly sharedFingerprintEnvs: readonly string[];
}

/** `console.vault.list` response. */
export interface VaultListResponse {
  readonly secrets: readonly VaultRecord[];
  readonly env: string;
}

/** Grouped list section (secrets vs config). */
export interface VaultKindGroup {
  readonly kind: "secret" | "config";
  readonly label: string;
  readonly secrets: readonly VaultRecord[];
}
