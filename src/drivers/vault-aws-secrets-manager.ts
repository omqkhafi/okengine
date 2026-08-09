/**
 * AWS Secrets Manager backend for the `managed` vault driver.
 *
 * Reads are snapshotted at `open` (the {@link VaultBag} surface is
 * synchronous); writes and deletes go straight to the API and are settled by
 * `close`.
 *
 * `@aws-sdk/client-secrets-manager` is an optional peer, imported dynamically
 * so a project on platform-injected secrets or another provider never pays for it.
 * Tests inject an {@link AwsSecretsManagerClient} and skip the SDK entirely.
 *
 * SDK errors are never re-thrown: their messages can echo request payloads,
 * which for this API means secret material. Every failure is translated into
 * a {@link VaultError} with a message this module authored.
 */

import { VaultError } from "../elements/vault/errors.ts";
import type { VaultBag } from "./vault-types.ts";

/** Package name of the optional peer, resolved at call time. */
const AWS_SM_PACKAGE = "@aws-sdk/client-secrets-manager";

/** AWS error name for a secret id that does not exist. */
const NOT_FOUND = "ResourceNotFoundException";

/**
 * Secret-name-addressed client the bag talks to.
 *
 * Names are bag names (`STRIPE_KEY`), never fully-qualified AWS secret ids —
 * the prefix belongs to the client, so the bag stays prefix-agnostic.
 */
export interface AwsSecretsManagerClient {
  /** Bag names visible to this credential under the configured prefix. */
  list(): Promise<readonly string[]>;
  /**
   * Read one secret's string value.
   *
   * @param name - Bag name
   */
  get(name: string): Promise<string | undefined>;
  /**
   * Create or overwrite one secret.
   *
   * @param name - Bag name
   * @param value - Cleartext
   */
  put(name: string, value: string): Promise<void>;
  /**
   * Delete one secret. A missing secret is not an error.
   *
   * @param name - Bag name
   */
  remove(name: string): Promise<void>;
  /** Release the underlying SDK client. */
  close?(): Promise<void>;
}

/** Options for {@link openAwsSecretsManagerBag}. */
export interface OpenAwsSecretsManagerOptions {
  /** AWS region. Falls back to the SDK's own resolution chain. */
  readonly region?: string;
  /** Secret-name prefix scoping this app (`oke/prod/`). */
  readonly prefix?: string;
  /** Injected client for tests — skips the SDK import entirely. */
  readonly client?: AwsSecretsManagerClient;
  /**
   * Declared names, used as the read set when `ListSecrets` is denied so a
   * least-privilege credential still boots.
   */
  readonly secrets?: Readonly<Record<string, string>>;
}

/**
 * Open a secret bag backed by AWS Secrets Manager.
 *
 * An unreachable or unauthorized API is fatal: the bag never silently
 * degrades to a seed-only view, because that turns a credentials outage into
 * a "missing secret contract" message pointing at the wrong thing.
 *
 * @param options - Region / prefix / injected client / declared names
 * @throws VaultError `MISSING_PEER` when the SDK is absent and no client is injected
 * @throws VaultError `BACKEND_ERROR` when the API rejects the read
 */
export async function openAwsSecretsManagerBag(
  options: OpenAwsSecretsManagerOptions = {},
): Promise<VaultBag> {
  const client = options.client ?? (await connectSecretsManager(options.region, options.prefix));
  const map = new Map<string, string>(
    Object.entries(options.secrets ?? {}).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );

  let listed: readonly string[] = [];
  try {
    listed = await client.list();
  } catch (error) {
    // ListSecrets is commonly denied on least-privilege roles; only fail when
    // there is no declared read set to fall back to.
    if (map.size === 0) throw asVaultError(error, "vault: aws secrets manager list failed");
  }

  const names = listed.length > 0 ? listed : [...map.keys()];
  for (const name of names) {
    let value: string | undefined;
    try {
      value = await client.get(name);
    } catch (error) {
      throw asVaultError(error, `vault: aws secrets manager read of "${name}" failed`);
    }
    if (value !== undefined) map.set(name, value);
  }

  const pending: Promise<void>[] = [];
  let failure: VaultError | undefined;
  /**
   * Run a write in the background, holding its failure for `close`.
   *
   * @param work - In-flight API call
   * @param message - Safe message when it rejects
   */
  function track(work: Promise<void>, message: string): void {
    pending.push(
      work.catch((error: unknown) => {
        failure ??= asVaultError(error, message);
      }),
    );
  }

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
      track(client.put(name, value), `vault: aws secrets manager write of "${name}" failed`);
    },
    delete(name) {
      const had = map.delete(name);
      track(client.remove(name), `vault: aws secrets manager delete of "${name}" failed`);
      return had;
    },
    async close() {
      await Promise.all(pending);
      await client.close?.();
      if (failure) throw failure;
    },
  };
}

/** Response fields this module reads off the SDK. */
interface SecretsManagerResult {
  readonly SecretString?: string;
  readonly SecretList?: readonly { readonly Name?: string }[];
  readonly NextToken?: string;
}

/** Structural SDK client — the SDK's `SecretsManagerClient` satisfies it. */
interface SdkClientLike {
  send(command: unknown): Promise<SecretsManagerResult>;
  destroy?(): void;
}

/** Constructors pulled off the dynamically imported module. */
interface SecretsManagerBindings {
  readonly SecretsManagerClient: new (config: { region?: string }) => SdkClientLike;
  readonly ListSecretsCommand: new (input: {
    Filters?: { Key: string; Values: string[] }[];
    MaxResults?: number;
    NextToken?: string;
  }) => unknown;
  readonly GetSecretValueCommand: new (input: { SecretId: string }) => unknown;
  readonly PutSecretValueCommand: new (input: {
    SecretId: string;
    SecretString: string;
  }) => unknown;
  readonly CreateSecretCommand: new (input: { Name: string; SecretString: string }) => unknown;
  readonly DeleteSecretCommand: new (input: {
    SecretId: string;
    ForceDeleteWithoutRecovery: boolean;
  }) => unknown;
}

/**
 * Build a real client over the optional AWS SDK peer.
 *
 * @param region - AWS region
 * @param prefix - Secret-name prefix scoping this app
 * @throws VaultError `MISSING_PEER` when the SDK is absent
 */
async function connectSecretsManager(
  region: string | undefined,
  prefix: string | undefined,
): Promise<AwsSecretsManagerClient> {
  const sdk = await loadSecretsManager();
  const at = prefix ?? "";
  const client = new sdk.SecretsManagerClient(region === undefined ? {} : { region });

  return {
    async list() {
      const names: string[] = [];
      let token: string | undefined;
      do {
        const page: SecretsManagerResult = await client.send(
          new sdk.ListSecretsCommand({
            ...(at === "" ? {} : { Filters: [{ Key: "name", Values: [at] }] }),
            MaxResults: 100,
            ...(token === undefined ? {} : { NextToken: token }),
          }),
        );
        for (const entry of page.SecretList ?? []) {
          const id = entry.Name;
          if (id === undefined || !id.startsWith(at)) continue;
          names.push(id.slice(at.length));
        }
        token = page.NextToken;
      } while (token !== undefined);
      return names;
    },
    async get(name) {
      try {
        const result = await client.send(
          new sdk.GetSecretValueCommand({ SecretId: `${at}${name}` }),
        );
        return result.SecretString;
      } catch (error) {
        if (errorName(error) === NOT_FOUND) return undefined;
        throw error;
      }
    },
    async put(name, value) {
      try {
        await client.send(
          new sdk.PutSecretValueCommand({ SecretId: `${at}${name}`, SecretString: value }),
        );
      } catch (error) {
        if (errorName(error) !== NOT_FOUND) throw error;
        await client.send(
          new sdk.CreateSecretCommand({ Name: `${at}${name}`, SecretString: value }),
        );
      }
    },
    async remove(name) {
      try {
        await client.send(
          new sdk.DeleteSecretCommand({
            SecretId: `${at}${name}`,
            ForceDeleteWithoutRecovery: true,
          }),
        );
      } catch (error) {
        if (errorName(error) !== NOT_FOUND) throw error;
      }
    },
    async close() {
      client.destroy?.();
    },
  };
}

/**
 * Import the optional `@aws-sdk/client-secrets-manager` peer.
 *
 * @throws VaultError `MISSING_PEER` with the exact install command
 */
async function loadSecretsManager(): Promise<SecretsManagerBindings> {
  // Indirect specifier: the peer is optional, so it must not become a
  // static dependency of the module graph.
  const specifier: string = AWS_SM_PACKAGE;
  let mod: unknown;
  try {
    mod = await import(specifier);
  } catch {
    throw new VaultError(
      "MISSING_PEER",
      `vault: managed provider "aws-secrets-manager" needs the optional peer \`${AWS_SM_PACKAGE}\` (bun add ${AWS_SM_PACKAGE})`,
    );
  }
  const bindings = mod as Partial<SecretsManagerBindings>;
  if (
    !bindings.SecretsManagerClient ||
    !bindings.ListSecretsCommand ||
    !bindings.GetSecretValueCommand ||
    !bindings.PutSecretValueCommand ||
    !bindings.CreateSecretCommand ||
    !bindings.DeleteSecretCommand
  ) {
    throw new VaultError(
      "MISSING_PEER",
      `vault: \`${AWS_SM_PACKAGE}\` is installed but does not export the SecretsManager client and commands`,
    );
  }
  return {
    SecretsManagerClient: bindings.SecretsManagerClient,
    ListSecretsCommand: bindings.ListSecretsCommand,
    GetSecretValueCommand: bindings.GetSecretValueCommand,
    PutSecretValueCommand: bindings.PutSecretValueCommand,
    CreateSecretCommand: bindings.CreateSecretCommand,
    DeleteSecretCommand: bindings.DeleteSecretCommand,
  };
}

/**
 * AWS error discriminator (`ResourceNotFoundException`, …).
 *
 * Reads only `name`, never `message`: the latter can quote request payloads.
 *
 * @param error - Thrown value
 */
function errorName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

/**
 * Translate a foreign failure into a secret-free {@link VaultError}.
 *
 * @param error - Thrown value
 * @param message - Safe message authored by this module
 */
function asVaultError(error: unknown, message: string): VaultError {
  if (error instanceof VaultError) return error;
  const name = errorName(error);
  if (name === "AccessDeniedException" || name === "UnrecognizedClientException") {
    return new VaultError("PERMISSION_DENIED", `${message} — credentials denied`);
  }
  return new VaultError("BACKEND_ERROR", message);
}
