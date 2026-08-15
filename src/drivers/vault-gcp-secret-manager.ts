/**
 * GCP Secret Manager backend for the `managed` vault driver.
 *
 * `@google-cloud/secret-manager` is an optional peer, imported dynamically
 * so a project on another provider never pays for it. Tests inject a
 * {@link RemoteSecretClient} and skip the SDK entirely.
 *
 * `OKE_VAULT_MOUNT` is `project` or `project/prefix`. When mount is omitted,
 * `GOOGLE_CLOUD_PROJECT` / `GCLOUD_PROJECT` supply the project id.
 */

import { VaultError } from "../elements/vault/errors.ts";
import {
  openRemoteSecretBag,
  remoteErrorCode,
  type RemoteSecretClient,
} from "./vault-remote-bag.ts";
import type { VaultBag } from "./vault-types.ts";

/** Package name of the optional peer, resolved at call time. */
const GCP_SM_PACKAGE = "@google-cloud/secret-manager";

/** GCP status codes this module discriminates. */
const GCP_NOT_FOUND = 5;
const GCP_PERMISSION_DENIED = 7;

/** Options for {@link openGcpSecretManagerBag}. */
export interface OpenGcpSecretManagerOptions {
  /**
   * `project` or `project/prefix`. Prefix is prepended to bag names
   * (`oke-prod-` → `oke-prod-STRIPE_KEY`).
   */
  readonly mount?: string;
  /** Replication region when creating secrets (user-managed). */
  readonly region?: string;
  /** Injected client for tests — skips the SDK import entirely. */
  readonly client?: RemoteSecretClient;
  /**
   * Declared names, used as the read set when list is denied so a
   * least-privilege credential still boots.
   */
  readonly secrets?: Readonly<Record<string, string>>;
}

/**
 * Open a secret bag backed by GCP Secret Manager.
 *
 * @param options - Project/prefix / region / injected client / declared names
 * @throws VaultError `MISSING_PEER` when the SDK is absent and no client is injected
 * @throws VaultError `BACKEND_ERROR` when the project is missing or the API rejects the read
 */
export async function openGcpSecretManagerBag(
  options: OpenGcpSecretManagerOptions = {},
): Promise<VaultBag> {
  const client =
    options.client ?? (await connectGcpSecretManager(options.mount, options.region));
  return openRemoteSecretBag({
    client,
    ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
    label: "gcp secret manager",
    asError: asGcpVaultError,
  });
}

/** One listed secret resource. */
interface GcpSecretResource {
  readonly name?: string | null;
}

/** Structural SDK client — `SecretManagerServiceClient` satisfies it. */
interface GcpSdkClient {
  listSecretsAsync?(req: { parent: string }): AsyncIterable<GcpSecretResource>;
  listSecrets(req: {
    parent: string;
    pageToken?: string;
  }): Promise<
    readonly [readonly GcpSecretResource[], unknown, { readonly nextPageToken?: string | null }?]
  >;
  accessSecretVersion(req: {
    name: string;
  }): Promise<readonly [{ readonly payload?: { readonly data?: Uint8Array | string | null } | null }]>;
  createSecret(req: { parent: string; secretId: string; secret: unknown }): Promise<unknown>;
  addSecretVersion(req: {
    parent: string;
    payload: { data: Uint8Array };
  }): Promise<unknown>;
  deleteSecret(req: { name: string }): Promise<unknown>;
  close?(): Promise<void>;
}

/** Constructor pulled off the dynamically imported module. */
interface GcpSecretManagerBindings {
  readonly SecretManagerServiceClient: new () => GcpSdkClient;
}

/**
 * Build a real client over the optional GCP SDK peer.
 *
 * @param mount - `project` or `project/prefix`
 * @param region - Optional user-managed replication location
 * @throws VaultError `BACKEND_ERROR` when the project id is missing
 * @throws VaultError `MISSING_PEER` when the SDK is absent
 */
async function connectGcpSecretManager(
  mount: string | undefined,
  region: string | undefined,
): Promise<RemoteSecretClient> {
  const { project, prefix } = splitGcpMount(mount);
  if (project.length === 0) {
    throw new VaultError(
      "BACKEND_ERROR",
      'vault: managed provider "gcp-secret-manager" needs OKE_VAULT_MOUNT (project or project/prefix)',
    );
  }
  const sdk = await loadGcpSecretManager();
  const client = new sdk.SecretManagerServiceClient();
  const parent = `projects/${project}`;

  return {
    async list() {
      const names: string[] = [];
      for await (const entry of iterateGcpSecrets(client, parent)) {
        const id = secretIdOf(entry.name);
        if (id === undefined || !id.startsWith(prefix)) continue;
        names.push(id.slice(prefix.length));
      }
      return names;
    },
    async get(name) {
      try {
        const [version] = await client.accessSecretVersion({
          name: `${parent}/secrets/${prefix}${name}/versions/latest`,
        });
        return decodePayload(version.payload?.data);
      } catch (error) {
        if (isGcpNotFound(error)) return undefined;
        throw error;
      }
    },
    async put(name, value) {
      const secretId = `${prefix}${name}`;
      const secretParent = `${parent}/secrets/${secretId}`;
      const payload = { data: new TextEncoder().encode(value) };
      try {
        await client.addSecretVersion({ parent: secretParent, payload });
      } catch (error) {
        if (!isGcpNotFound(error)) throw error;
        await client.createSecret({
          parent,
          secretId,
          secret: replicationOf(region),
        });
        await client.addSecretVersion({ parent: secretParent, payload });
      }
    },
    async remove(name) {
      try {
        await client.deleteSecret({ name: `${parent}/secrets/${prefix}${name}` });
      } catch (error) {
        if (!isGcpNotFound(error)) throw error;
      }
    },
    async close() {
      await client.close?.();
    },
  };
}

/**
 * Split `project` or `project/prefix` and fall back to GCP's project env.
 *
 * @param mount - `OKE_VAULT_MOUNT`
 */
function splitGcpMount(mount: string | undefined): { project: string; prefix: string } {
  const raw = mount?.trim() ?? "";
  if (raw.length === 0) {
    const fromEnv =
      process.env.GOOGLE_CLOUD_PROJECT?.trim() ?? process.env.GCLOUD_PROJECT?.trim() ?? "";
    return { project: fromEnv, prefix: "" };
  }
  const slash = raw.indexOf("/");
  if (slash <= 0) return { project: raw, prefix: "" };
  return { project: raw.slice(0, slash), prefix: raw.slice(slash + 1) };
}

/**
 * Walk every secret under `parent`, following pages when the async helper is absent.
 *
 * @param client - SDK client
 * @param parent - `projects/{project}`
 */
async function* iterateGcpSecrets(
  client: GcpSdkClient,
  parent: string,
): AsyncGenerator<GcpSecretResource> {
  if (client.listSecretsAsync) {
    for await (const entry of client.listSecretsAsync({ parent })) yield entry;
    return;
  }
  let token: string | undefined;
  do {
    const [page, , extra] = await client.listSecrets({
      parent,
      ...(token === undefined ? {} : { pageToken: token }),
    });
    for (const entry of page) yield entry;
    token = extra?.nextPageToken ?? undefined;
  } while (token !== undefined && token.length > 0);
}

/**
 * Last path segment of `projects/{project}/secrets/{id}`.
 *
 * @param resource - Full resource name
 */
function secretIdOf(resource: string | null | undefined): string | undefined {
  if (resource === undefined || resource === null || resource.length === 0) return undefined;
  const slash = resource.lastIndexOf("/");
  return slash === -1 ? resource : resource.slice(slash + 1);
}

/**
 * Decode a Secret Manager payload without assuming Buffer.
 *
 * @param data - Bytes or string
 */
function decodePayload(data: Uint8Array | string | null | undefined): string | undefined {
  if (data === undefined || data === null) return undefined;
  if (typeof data === "string") return data;
  return new TextDecoder().decode(data);
}

/**
 * Replication policy for a newly created secret.
 *
 * @param region - Optional user-managed location
 */
function replicationOf(region: string | undefined): unknown {
  const location = region?.trim() ?? "";
  if (location.length === 0) return { replication: { automatic: {} } };
  return { replication: { userManaged: { replicas: [{ location }] } } };
}

/**
 * Import the optional `@google-cloud/secret-manager` peer.
 *
 * @throws VaultError `MISSING_PEER` with the exact install command
 */
async function loadGcpSecretManager(): Promise<GcpSecretManagerBindings> {
  const specifier: string = GCP_SM_PACKAGE;
  let mod: unknown;
  try {
    mod = await import(specifier);
  } catch {
    throw new VaultError(
      "MISSING_PEER",
      `vault: managed provider "gcp-secret-manager" needs the optional peer \`${GCP_SM_PACKAGE}\` (bun add ${GCP_SM_PACKAGE})`,
    );
  }
  const bindings = mod as Partial<GcpSecretManagerBindings>;
  if (!bindings.SecretManagerServiceClient) {
    throw new VaultError(
      "MISSING_PEER",
      `vault: \`${GCP_SM_PACKAGE}\` is installed but does not export SecretManagerServiceClient`,
    );
  }
  return { SecretManagerServiceClient: bindings.SecretManagerServiceClient };
}

/**
 * GCP NOT_FOUND discriminator (`code` 5).
 *
 * @param error - Thrown value
 */
function isGcpNotFound(error: unknown): boolean {
  const code = remoteErrorCode(error);
  return code === GCP_NOT_FOUND || code === "NOT_FOUND" || code === 404;
}

/**
 * Translate a foreign GCP failure into a secret-free {@link VaultError}.
 *
 * @param error - Thrown value
 * @param message - Safe message authored by this module
 */
function asGcpVaultError(error: unknown, message: string): VaultError {
  if (error instanceof VaultError) return error;
  const code = remoteErrorCode(error);
  if (code === GCP_PERMISSION_DENIED || code === "PERMISSION_DENIED" || code === 403) {
    return new VaultError("PERMISSION_DENIED", `${message} — credentials denied`);
  }
  return new VaultError("BACKEND_ERROR", message);
}
