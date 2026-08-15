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
  env: "No remote store — values come from process.env and .env.local",
  managed: "Managed KMS / provider secret store",
  memory: "In-memory bag — test only, nothing survives restart",
};

const PROVIDER_TITLE: Readonly<Record<string, string>> = {
  "aws-secrets-manager": "AWS Secrets Manager",
  "azure-key-vault": "Azure Key Vault",
  "gcp-secret-manager": "GCP Secret Manager",
  doppler: "Doppler",
  "1password": "1Password",
};

const PROVIDER_KIND: Readonly<Record<string, string>> = {
  "aws-secrets-manager": "aws",
  "azure-key-vault": "azure",
  "gcp-secret-manager": "gcp",
  doppler: "doppler",
  "1password": "1password",
};

/**
 * Lock-path label — always `driver`. Kind (built-in vs managed) lives in
 * {@link vaultDriverTitle} / {@link vaultDriverHint}.
 *
 * @param _backend - Unused; kept so call sites stay typed
 */
export function vaultDriverShortLabel(_backend?: VaultBackend | null): string {
  return "driver";
}

/**
 * Headline for the backend card and the selected lock-path layer.
 *
 * @param backend - Server-reported backend
 */
export function vaultDriverTitle(backend: VaultBackend | null | undefined): string {
  if (!backend) return "Vault backend";
  switch (backend.driverId) {
    case "vault":
      return "Built-in vault";
    case "managed": {
      const id = backend.provider?.trim() ?? "";
      if (id.length === 0) return "Managed vault";
      return PROVIDER_TITLE[id] ?? `Managed · ${id}`;
    }
    case "memory":
      return "Memory bag";
    case "env":
      return "Simulated env";
  }
}

/**
 * Kind on the lock-path driver step — built-in, managed, or neither.
 *
 * @param backend - Server-reported backend
 */
export function vaultDriverKind(backend: VaultBackend | null | undefined): string {
  if (!backend) return "unknown";
  switch (backend.driverId) {
    case "vault":
      return "built-in";
    case "managed": {
      const id = backend.provider?.trim() ?? "";
      const kind = PROVIDER_KIND[id];
      if (kind !== undefined) return `managed · ${kind}`;
      if (id.length > 0) return `managed · ${id.length > 8 ? id.slice(0, 8) : id}`;
      return "managed";
    }
    case "memory":
      return "memory";
    case "env":
      return "simulate";
  }
}

/**
 * One-line explanation of the driver layer.
 *
 * @param backend - Server-reported backend
 */
export function vaultDriverHint(backend: VaultBackend | null | undefined): string {
  if (!backend) return "Set drivers.vault to built-in vault or a managed provider";
  switch (backend.driverId) {
    case "vault":
      return "Built-in vault — encrypted at rest, sealed until unsealed with the master key";
    case "managed": {
      const id = backend.provider?.trim() ?? "";
      if (id === "aws-secrets-manager") return "Managed provider — AWS Secrets Manager";
      if (id.length > 0) return `Managed provider — ${id}`;
      return "Managed provider — platform-injected secrets (no remote provider id)";
    }
    case "memory":
      return "In-memory driver — test only, nothing survives restart";
    case "env":
      return "No built-in vault or managed provider — values come from process.env and .env.local";
    default:
      return DRIVER_DESCRIPTION[backend.driverId] ?? "Custom vault backend";
  }
}

/**
 * Build the status card for a backend.
 *
 * @param backend - Server-reported backend, or `null` when unresolved
 */
export function formatVaultBackend(backend: VaultBackend | null): VaultBackendCard | null {
  if (!backend) return null;

  const title = vaultDriverTitle(backend);
  const description = vaultDriverHint(backend);

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
