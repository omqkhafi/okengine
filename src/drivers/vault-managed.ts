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
 * Official providers: AWS Secrets Manager, Azure Key Vault, GCP Secret
 * Manager, Doppler, 1Password Connect. Unknown ids fail loud with
 * {@link VaultError} `UNSUPPORTED`.
 */

import { VaultError } from "../elements/vault/errors.ts";
import type { RemoteSecretClient } from "./vault-remote-bag.ts";
import type { VaultBag, VaultDriver, VaultOpenOptions } from "./vault-types.ts";

/** Official backends `managed` ships today. */
export const MANAGED_VAULT_PROVIDER_IDS = [
  "aws-secrets-manager",
  "azure-key-vault",
  "gcp-secret-manager",
  "doppler",
  "1password",
] as const;

/** Official backends `managed` ships today. */
export type ManagedVaultProviderId = (typeof MANAGED_VAULT_PROVIDER_IDS)[number];

/** Supported provider ids, for error messages. */
export const MANAGED_VAULT_PROVIDER_LIST: string = MANAGED_VAULT_PROVIDER_IDS.join(" · ");

/** Options for {@link createManagedVaultBag}. */
export interface ManagedVaultOptions extends VaultOpenOptions {
  /** Injected remote client for tests. */
  readonly client?: RemoteSecretClient;
}

/**
 * Open the bag for the selected managed provider.
 *
 * @param options - Provider id plus that provider's connection options
 * @throws VaultError `UNSUPPORTED` for an unknown provider
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

  if (provider === "azure-key-vault") {
    const { openAzureKeyVaultBag } = await import("./vault-azure-key-vault.ts");
    return openAzureKeyVaultBag({
      ...(options.url === undefined ? {} : { url: options.url }),
      ...(options.mount === undefined ? {} : { prefix: options.mount }),
      ...(options.client === undefined ? {} : { client: options.client }),
      ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
    });
  }

  if (provider === "gcp-secret-manager") {
    const { openGcpSecretManagerBag } = await import("./vault-gcp-secret-manager.ts");
    return openGcpSecretManagerBag({
      ...(options.mount === undefined ? {} : { mount: options.mount }),
      ...(options.region === undefined ? {} : { region: options.region }),
      ...(options.client === undefined ? {} : { client: options.client }),
      ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
    });
  }

  if (provider === "doppler") {
    const { openDopplerBag } = await import("./vault-doppler.ts");
    return openDopplerBag({
      ...(options.token === undefined ? {} : { token: options.token }),
      ...(options.url === undefined ? {} : { url: options.url }),
      ...(options.mount === undefined ? {} : { mount: options.mount }),
      ...(options.client === undefined ? {} : { client: options.client }),
      ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  if (provider === "1password") {
    const { openOnePasswordBag } = await import("./vault-1password.ts");
    return openOnePasswordBag({
      ...(options.url === undefined ? {} : { url: options.url }),
      ...(options.token === undefined ? {} : { token: options.token }),
      ...(options.mount === undefined ? {} : { mount: options.mount }),
      ...(options.client === undefined ? {} : { client: options.client }),
      ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  throw new VaultError(
    "UNSUPPORTED",
    `vault: unknown managed provider "${provider}" (expected ${MANAGED_VAULT_PROVIDER_LIST}). ` +
      'Official backends: managed providers above, or built-in vault (drivers.vault: "vault").',
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
