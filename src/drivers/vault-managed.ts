/**
 * `managed` vault driver — one selector over the supported secret backends.
 *
 * With no `provider` the driver keeps its original shape: values arrive as an
 * injected map (or env), the way Fly / Railway / K8s hand them over, and OKE
 * never invents a vendor client.
 *
 * With a `provider` the driver delegates, and the bag reports the backend's
 * own protocol id — `managed` is a selector, not a protocol. Backends load
 * dynamically so a project on one provider never pays for the others.
 *
 * Official provider: `aws-secrets-manager`. Community plugins can implement
 * additional adapters; unknown ids fail loud with {@link VaultError} `UNSUPPORTED`.
 */

import { VaultError } from "../elements/vault/errors.ts";
import type { AwsSecretsManagerClient } from "./vault-aws-secrets-manager.ts";
import type { VaultBag, VaultDriver, VaultOpenOptions } from "./vault-types.ts";

/** Official backends `managed` ships today. */
export type ManagedVaultProviderId = "aws-secrets-manager";

/** Providers named in config but not implemented in core — reported, not guessed. */
const DEFERRED_PROVIDERS: readonly string[] = [
  "azure-key-vault",
  "gcp-secret-manager",
  "doppler",
  "1password",
];

/** Supported provider ids, for error messages. */
const SUPPORTED_PROVIDERS = "aws-secrets-manager";

/** Options for {@link createManagedVaultBag}. */
export interface ManagedVaultOptions extends VaultOpenOptions {
  /** Injected AWS Secrets Manager client for tests. */
  readonly client?: AwsSecretsManagerClient;
}

/**
 * Open the bag for the selected managed provider.
 *
 * @param options - Provider id plus that provider's connection options
 * @throws VaultError `UNSUPPORTED` for a deferred or unknown provider
 */
export async function createManagedVaultBag(options: ManagedVaultOptions = {}): Promise<VaultBag> {
  const provider = options.provider?.trim().toLowerCase();

  if (provider === undefined || provider === "") return injectedBag(options);

  if (provider === "aws-secrets-manager") {
    const { openAwsSecretsManagerBag } = await import("./vault-aws-secrets-manager.ts");
    return openAwsSecretsManagerBag({
      ...(options.region === undefined ? {} : { region: options.region }),
      ...(options.mount === undefined ? {} : { prefix: options.mount }),
      ...(options.client === undefined ? {} : { client: options.client }),
      ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
    });
  }

  if (DEFERRED_PROVIDERS.includes(provider)) {
    throw new VaultError(
      "UNSUPPORTED",
      `vault: managed provider "${provider}" is not implemented yet — official: ${SUPPORTED_PROVIDERS}. ` +
        "Community adapters can implement ManagedAdapter / open via a plugin.",
    );
  }

  throw new VaultError(
    "UNSUPPORTED",
    `vault: unknown managed provider "${provider}" (expected ${SUPPORTED_PROVIDERS}). ` +
      'Official backends: aws-secrets-manager or built-in vault (drivers.vault: "vault").',
  );
}

/**
 * Platform-injected bag — env vars plus an explicit seed map.
 *
 * @param options - Seed / env overrides
 */
function injectedBag(options: VaultOpenOptions): VaultBag {
  const fromSecrets = Object.entries(options.secrets ?? {}).filter(
    (e): e is [string, string] => typeof e[1] === "string",
  );
  const fromEnv = Object.entries(options.env ?? process.env).filter(
    (e): e is [string, string] => typeof e[1] === "string" && e[1].length > 0,
  );
  const map = new Map<string, string>([...fromEnv, ...fromSecrets]);
  return {
    driverId: "managed",
    get(name) {
      return map.get(name);
    },
    names() {
      return [...map.keys()];
    },
    set(name, value) {
      map.set(name, value);
    },
    delete(name) {
      return map.delete(name);
    },
  };
}

/**
 * Managed / platform vault driver.
 */
export const managedVaultDriver: VaultDriver = {
  id: "managed",
  open(options: ManagedVaultOptions = {}): Promise<VaultBag> {
    return createManagedVaultBag(options);
  },
};
