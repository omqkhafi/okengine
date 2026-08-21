/**
 * Vault page types (console §9.8) — matches `GET /console/vault`.
 */

/** Resolution layer id — matches VaultRuntime sources. */
export type VaultResolutionSource = "process.env" | ".env.local" | "driver" | "dev-fallback";

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
  /** `"console"` is an operator Add not yet in the Manifest. */
  readonly origin?: "source" | "console";
}

/** Vault backend driver id — matches `drivers.vault`. */
export type VaultDriverId = "env" | "vault" | "managed" | "memory";

/** Built-in Vault backend state (epoch-ms timestamps). */
export interface VaultBuiltinStatus {
  readonly initialized: boolean;
  readonly sealed: boolean;
  readonly masterKeyPresent: boolean;
  readonly kekVersion: number;
  readonly secretCount: number;
  readonly sealCount: number;
  readonly lastSealedAt: number | null;
  readonly lastUnsealedAt: number | null;
  readonly rewrapTargetKekVersion: number | null;
}

/** Backend serving the terminal layer of the resolution chain. */
export interface VaultBackend {
  readonly driverId: VaultDriverId;
  readonly builtin: boolean;
  readonly status: VaultBuiltinStatus | null;
  readonly unavailable: string | null;
  /** Managed provider id (`aws-secrets-manager`); `null` for other drivers. */
  readonly provider?: string | null;
}

/** `console.vault.list` response. */
export interface VaultListResponse {
  readonly secrets: readonly VaultRecord[];
  readonly env: string;
  /** `null` when the server could not resolve a backend. */
  readonly backend: VaultBackend | null;
}

/** Grouped list section (secrets vs config). */
export interface VaultKindGroup {
  readonly kind: "secret" | "config";
  readonly label: string;
  readonly secrets: readonly VaultRecord[];
}

/** Operator-safe audit row from `GET /console/vault/audit/verify`. */
export interface VaultAuditRow {
  readonly id: string;
  readonly seq: number;
  readonly action: string;
  readonly path: string | null;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly success: boolean;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly requestId: string | null;
  readonly createdAt: number;
}

/** `GET /console/vault/audit/verify` body. */
export interface VaultAuditVerifyResult {
  readonly ok: boolean;
  readonly brokenAt: string | null;
  readonly reason: "link" | "payload" | null;
  readonly row: VaultAuditRow | null;
}

/** `POST /console/vault/rotate-master` success body. */
export interface VaultRotateMasterResult {
  readonly ok: true;
  readonly kekVersion: number;
  readonly remaining: number;
  readonly masterKey: string | null;
  readonly at: string;
}
