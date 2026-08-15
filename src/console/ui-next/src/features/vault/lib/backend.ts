/**
 * Format the Vault backend status card (console §9.8).
 *
 * Only the built-in `vault` driver has a seal lifecycle; every other driver
 * shows its id alone so the operator still knows which layer starts the
 * resolution chain.
 */

import type { VaultBackend } from "./types.ts";

/** One badge in the status card. */
export interface VaultBackendBadge {
  /** Stable id for keys and tests. */
  readonly id: string;
  /** Short badge text. */
  readonly label: string;
  /** `warn` renders as an alert; `ok` and `neutral` are status text. */
  readonly tone: "ok" | "warn" | "neutral";
}

/** Rendered status card. */
export interface VaultBackendCard {
  /** Driver id headline (`Backend vault`). */
  readonly title: string;
  /** One-line explanation of what that backend is. */
  readonly description: string;
  /** Seal / initialization badges — empty for non-builtin drivers. */
  readonly badges: readonly VaultBackendBadge[];
  /** `label: value` facts (KEK generation, secret count, …). */
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  /** Operator next step, when one applies. */
  readonly hint: string | null;
}

/** What each driver id means, in one line. */
const DRIVER_DESCRIPTION: Readonly<Record<string, string>> = {
  vault: "okengine's own store — encrypted at rest, sealed until unsealed with the master key",
  env: "Environment layers only — process.env, .env.local, docker/.env.docker",
  managed: "Managed KMS / provider secret store",
  memory: "In-memory bag — test only, nothing survives restart",
};

/**
 * Build the status card for a backend.
 *
 * @param backend - Server-reported backend, or `null` when unresolved
 */
export function formatVaultBackend(backend: VaultBackend | null): VaultBackendCard | null {
  if (!backend) return null;

  const title = `Backend ${backend.driverId}`;
  const description = DRIVER_DESCRIPTION[backend.driverId] ?? "Custom vault backend";

  if (!backend.builtin) {
    return { title, description, badges: [], facts: [], hint: null };
  }

  const status = backend.status;
  if (!status) {
    return {
      title,
      description,
      badges: [{ id: "unreachable", label: "status unavailable", tone: "warn" }],
      facts: [],
      hint: backend.unavailable ?? "Run `oke vault status` to inspect the backend directly",
    };
  }

  if (!status.initialized) {
    return {
      title,
      description,
      badges: [{ id: "uninitialized", label: "not initialized", tone: "warn" }],
      facts: [],
      hint: "Run `oke vault init` to create the vault and print its master key once",
    };
  }

  const badges: VaultBackendBadge[] = [
    { id: "initialized", label: "initialized", tone: "ok" },
    status.sealed
      ? { id: "sealed", label: "sealed", tone: "warn" }
      : { id: "unsealed", label: "unsealed", tone: "ok" },
  ];
  if (status.rewrapTargetKekVersion !== null) {
    badges.push({
      id: "rewrap",
      label: `rewrap → kek v${status.rewrapTargetKekVersion}`,
      tone: "warn",
    });
  }

  const facts: { label: string; value: string }[] = [
    { label: "KEK generation", value: `v${status.kekVersion}` },
    { label: "Secrets stored", value: String(status.secretCount) },
    { label: "Seal count", value: String(status.sealCount) },
  ];
  if (status.lastUnsealedAt !== null) {
    facts.push({
      label: "Last unsealed",
      value: new Date(status.lastUnsealedAt).toISOString(),
    });
  }
  if (status.lastSealedAt !== null) {
    facts.push({ label: "Last sealed", value: new Date(status.lastSealedAt).toISOString() });
  }

  return {
    title,
    description,
    badges,
    facts,
    hint: status.sealed
      ? "This process holds no master key — export OKE_VAULT_MASTER_KEY or run `oke vault unseal`"
      : null,
  };
}
