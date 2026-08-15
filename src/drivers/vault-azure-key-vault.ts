/**
 * Azure Key Vault backend for the `managed` vault driver.
 *
 * `@azure/keyvault-secrets` and `@azure/identity` are optional peers, imported
 * dynamically so a project on another provider never pays for them. Tests
 * inject a {@link RemoteSecretClient} and skip the SDK entirely.
 *
 * Azure secret names allow only `[0-9a-zA-Z-]`. Contract names use `_`; this
 * module maps `_` → `-` on the wire and reverses it on list.
 */

import { VaultError } from "../elements/vault/errors.ts";
import {
  openRemoteSecretBag,
  remoteErrorCode,
  type RemoteSecretClient,
} from "./vault-remote-bag.ts";
import type { VaultBag } from "./vault-types.ts";

/** Package names of the optional peers, resolved at call time. */
const AZURE_SECRETS_PACKAGE = "@azure/keyvault-secrets";
const AZURE_IDENTITY_PACKAGE = "@azure/identity";

/** Options for {@link openAzureKeyVaultBag}. */
export interface OpenAzureKeyVaultOptions {
  /** Key Vault URI (`https://app.vault.azure.net`). */
  readonly url?: string;
  /** Secret-name prefix scoping this app (`oke-prod-`). */
  readonly prefix?: string;
  /** Injected client for tests — skips the SDK import entirely. */
  readonly client?: RemoteSecretClient;
  /**
   * Declared names, used as the read set when list is denied so a
   * least-privilege credential still boots.
   */
  readonly secrets?: Readonly<Record<string, string>>;
}

/**
 * Open a secret bag backed by Azure Key Vault.
 *
 * @param options - Vault URI / prefix / injected client / declared names
 * @throws VaultError `MISSING_PEER` when the SDK is absent and no client is injected
 * @throws VaultError `BACKEND_ERROR` when the vault URI is missing or the API rejects the read
 */
export async function openAzureKeyVaultBag(
  options: OpenAzureKeyVaultOptions = {},
): Promise<VaultBag> {
  const client = options.client ?? (await connectAzureKeyVault(options.url, options.prefix));
  return openRemoteSecretBag({
    client,
    ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
    label: "azure key vault",
    asError: asAzureVaultError,
  });
}

/** Structural SDK secret client — `SecretClient` satisfies it. */
interface AzureSdkSecretClient {
  listPropertiesOfSecrets(): AsyncIterable<{ readonly name?: string }>;
  getSecret(name: string): Promise<{ readonly value?: string }>;
  setSecret(name: string, value: string): Promise<unknown>;
  beginDeleteSecret(name: string): Promise<{ pollUntilDone(): Promise<unknown> }>;
  purgeDeletedSecret?(name: string): Promise<void>;
}

/** Constructors pulled off the dynamically imported modules. */
interface AzureSecretsBindings {
  readonly SecretClient: new (vaultUrl: string, credential: unknown) => AzureSdkSecretClient;
}

/** Identity bindings — only `DefaultAzureCredential` is required. */
interface AzureIdentityBindings {
  readonly DefaultAzureCredential: new () => unknown;
}

/**
 * Build a real client over the optional Azure SDK peers.
 *
 * @param url - Key Vault URI
 * @param prefix - Secret-name prefix scoping this app
 * @throws VaultError `BACKEND_ERROR` when the URI is missing
 * @throws VaultError `MISSING_PEER` when either peer is absent
 */
async function connectAzureKeyVault(
  url: string | undefined,
  prefix: string | undefined,
): Promise<RemoteSecretClient> {
  const vaultUrl = url?.trim() ?? "";
  if (vaultUrl.length === 0) {
    throw new VaultError(
      "BACKEND_ERROR",
      'vault: managed provider "azure-key-vault" needs OKE_VAULT_URL (Key Vault URI)',
    );
  }
  const secrets = await loadAzureSecrets();
  const identity = await loadAzureIdentity();
  const at = prefix ?? "";
  const client = new secrets.SecretClient(vaultUrl, new identity.DefaultAzureCredential());

  return {
    async list() {
      const names: string[] = [];
      for await (const entry of client.listPropertiesOfSecrets()) {
        const id = entry.name;
        if (id === undefined || !id.startsWith(at)) continue;
        names.push(fromAzureName(id.slice(at.length)));
      }
      return names;
    },
    async get(name) {
      try {
        const result = await client.getSecret(`${at}${toAzureName(name)}`);
        return result.value;
      } catch (error) {
        if (isAzureNotFound(error)) return undefined;
        throw error;
      }
    },
    async put(name, value) {
      await client.setSecret(`${at}${toAzureName(name)}`, value);
    },
    async remove(name) {
      const id = `${at}${toAzureName(name)}`;
      try {
        const poller = await client.beginDeleteSecret(id);
        await poller.pollUntilDone();
      } catch (error) {
        if (!isAzureNotFound(error)) throw error;
        return;
      }
      try {
        await client.purgeDeletedSecret?.(id);
      } catch {
        // Soft-delete vaults may deny purge; the secret is already gone from list.
      }
    },
  };
}

/**
 * Map a bag name onto an Azure-legal secret name (`_` → `-`).
 *
 * @param name - Bag name
 */
export function toAzureName(name: string): string {
  return name.replaceAll("_", "-");
}

/**
 * Reverse {@link toAzureName} so listed Azure names become bag names.
 *
 * @param name - Azure secret name without prefix
 */
export function fromAzureName(name: string): string {
  return name.replaceAll("-", "_");
}

/**
 * Import the optional `@azure/keyvault-secrets` peer.
 *
 * @throws VaultError `MISSING_PEER` with the exact install command
 */
async function loadAzureSecrets(): Promise<AzureSecretsBindings> {
  const specifier: string = AZURE_SECRETS_PACKAGE;
  let mod: unknown;
  try {
    mod = await import(specifier);
  } catch {
    throw missingAzurePeer();
  }
  const bindings = mod as Partial<AzureSecretsBindings>;
  if (!bindings.SecretClient) {
    throw new VaultError(
      "MISSING_PEER",
      `vault: \`${AZURE_SECRETS_PACKAGE}\` is installed but does not export SecretClient`,
    );
  }
  return { SecretClient: bindings.SecretClient };
}

/**
 * Import the optional `@azure/identity` peer.
 *
 * @throws VaultError `MISSING_PEER` with the exact install command
 */
async function loadAzureIdentity(): Promise<AzureIdentityBindings> {
  const specifier: string = AZURE_IDENTITY_PACKAGE;
  let mod: unknown;
  try {
    mod = await import(specifier);
  } catch {
    throw missingAzurePeer();
  }
  const bindings = mod as Partial<AzureIdentityBindings>;
  if (!bindings.DefaultAzureCredential) {
    throw new VaultError(
      "MISSING_PEER",
      `vault: \`${AZURE_IDENTITY_PACKAGE}\` is installed but does not export DefaultAzureCredential`,
    );
  }
  return { DefaultAzureCredential: bindings.DefaultAzureCredential };
}

/**
 * Shared install hint — both Azure peers are required together.
 */
function missingAzurePeer(): VaultError {
  return new VaultError(
    "MISSING_PEER",
    `vault: managed provider "azure-key-vault" needs the optional peers \`${AZURE_SECRETS_PACKAGE}\` and \`${AZURE_IDENTITY_PACKAGE}\` (bun add ${AZURE_SECRETS_PACKAGE} ${AZURE_IDENTITY_PACKAGE})`,
  );
}

/**
 * Azure 404 / SecretNotFound discriminator.
 *
 * @param error - Thrown value
 */
function isAzureNotFound(error: unknown): boolean {
  const code = remoteErrorCode(error);
  if (code === 404 || code === "SecretNotFound") return true;
  if (typeof error === "object" && error !== null) {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (status === 404) return true;
  }
  return false;
}

/**
 * Translate a foreign Azure failure into a secret-free {@link VaultError}.
 *
 * @param error - Thrown value
 * @param message - Safe message authored by this module
 */
function asAzureVaultError(error: unknown, message: string): VaultError {
  if (error instanceof VaultError) return error;
  const code = remoteErrorCode(error);
  if (code === 401 || code === 403 || code === "Unauthorized" || code === "Forbidden") {
    return new VaultError("PERMISSION_DENIED", `${message} — credentials denied`);
  }
  return new VaultError("BACKEND_ERROR", message);
}
