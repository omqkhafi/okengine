/**
 * Shared remote-provider bag — snapshot at `open`, write-through, settle on `close`.
 *
 * Every official managed backend (AWS, Azure, GCP, Doppler, 1Password) uses
 * this physics so a credentials outage never degrades to a silently empty
 * seed-only view. SDK / HTTP errors are translated here; their messages are
 * never copied, because they can echo secret material.
 */

import { VaultError } from "../elements/vault/errors.ts";
import type { VaultBag } from "./vault-types.ts";

/**
 * Secret-name-addressed client a remote bag talks to.
 *
 * Names are bag names (`STRIPE_KEY`), never fully-qualified vendor ids —
 * prefix / project / vault scoping belongs to the client.
 */
export interface RemoteSecretClient {
  /** Bag names visible to this credential under the configured scope. */
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
   * @param name - Secret name
   */
  remove(name: string): Promise<void>;
  /** Release the underlying SDK / HTTP client. */
  close?(): Promise<void>;
}

/** Translate a foreign failure into a secret-free {@link VaultError}. */
export type VaultErrorTranslator = (error: unknown, message: string) => VaultError;

/** Options for {@link openRemoteSecretBag}. */
export interface OpenRemoteSecretBagOptions {
  /** Vendor client. */
  readonly client: RemoteSecretClient;
  /**
   * Declared names, used as the read set when list is denied so a
   * least-privilege credential still boots.
   */
  readonly secrets?: Readonly<Record<string, string>>;
  /** Lowercase vendor label interpolated into authored error messages. */
  readonly label: string;
  /** Override the default translator (vendor-specific permission codes). */
  readonly asError?: VaultErrorTranslator;
}

/**
 * Default translator — keeps {@link VaultError} as-is, otherwise `BACKEND_ERROR`.
 *
 * @param error - Thrown value
 * @param message - Safe message authored by the caller
 */
export function asRemoteVaultError(error: unknown, message: string): VaultError {
  if (error instanceof VaultError) return error;
  return new VaultError("BACKEND_ERROR", message);
}

/**
 * Open a secret bag backed by a remote {@link RemoteSecretClient}.
 *
 * An unreachable or unauthorized API is fatal: the bag never silently
 * degrades to a seed-only view, because that turns a credentials outage into
 * a "missing secret contract" message pointing at the wrong thing.
 *
 * @param options - Client / seed / label / translator
 * @throws VaultError `BACKEND_ERROR` or `PERMISSION_DENIED` when the API rejects the read
 */
export async function openRemoteSecretBag(options: OpenRemoteSecretBagOptions): Promise<VaultBag> {
  const translate = options.asError ?? asRemoteVaultError;
  const client = options.client;
  const map = new Map<string, string>(
    Object.entries(options.secrets ?? {}).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );

  let listed: readonly string[] = [];
  try {
    listed = await client.list();
  } catch (error) {
    // List is commonly denied on least-privilege roles; only fail when
    // there is no declared read set to fall back to.
    if (map.size === 0) throw translate(error, `vault: ${options.label} list failed`);
  }

  const names = listed.length > 0 ? listed : [...map.keys()];
  for (const name of names) {
    let value: string | undefined;
    try {
      value = await client.get(name);
    } catch (error) {
      throw translate(error, `vault: ${options.label} read of "${name}" failed`);
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
        failure ??= translate(error, message);
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
      track(client.put(name, value), `vault: ${options.label} write of "${name}" failed`);
    },
    delete(name) {
      const had = map.delete(name);
      track(client.remove(name), `vault: ${options.label} delete of "${name}" failed`);
      return had;
    },
    async close() {
      await Promise.all(pending);
      await client.close?.();
      if (failure) throw failure;
    },
  };
}

/** Options for {@link vaultHttpJson}. */
export interface VaultHttpJsonOptions {
  /** HTTP statuses that return instead of throwing (e.g. 404 on get). */
  readonly allow?: readonly number[];
}

/** Result of {@link vaultHttpJson}. */
export interface VaultHttpJsonResult {
  /** Response status. */
  readonly status: number;
  /** Parsed JSON, or `undefined` when the body is empty / not JSON. */
  readonly body: unknown;
}

/**
 * `fetch` + JSON parse that never copies the response body into {@link VaultError}.
 *
 * @param fetchFn - Fetch implementation
 * @param url - Absolute URL
 * @param init - Request init
 * @param message - Safe message when the call fails
 * @param options - Statuses to allow through
 */
export async function vaultHttpJson(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  message: string,
  options: VaultHttpJsonOptions = {},
): Promise<VaultHttpJsonResult> {
  let response: Response;
  try {
    response = await fetchFn(url, init);
  } catch (error) {
    throw asRemoteVaultError(error, message);
  }
  const allowed = options.allow ?? [];
  if (allowed.includes(response.status)) {
    return { status: response.status, body: await readJsonSilent(response) };
  }
  if (response.status === 401 || response.status === 403) {
    throw new VaultError("PERMISSION_DENIED", `${message} — credentials denied`);
  }
  if (!response.ok) {
    throw new VaultError("BACKEND_ERROR", message);
  }
  return { status: response.status, body: await readJsonSilent(response) };
}

/**
 * Parse JSON without turning a malformed body into a leaky error message.
 *
 * @param response - Fetch response
 */
async function readJsonSilent(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Read a structural `name` / `code` / `status` off a foreign error.
 *
 * Never reads `message`: vendor SDKs quote request payloads there.
 *
 * @param error - Thrown value
 */
export function remoteErrorCode(error: unknown): string | number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as { name?: unknown; code?: unknown; statusCode?: unknown; status?: unknown };
  // Numeric status/code first — GCP gRPC uses `code: 7` on a generic `Error`.
  if (typeof record.code === "number") return record.code;
  if (typeof record.statusCode === "number") return record.statusCode;
  if (typeof record.status === "number") return record.status;
  if (typeof record.name === "string" && record.name !== "Error") return record.name;
  if (typeof record.code === "string") return record.code;
  if (typeof record.status === "string") return record.status;
  if (typeof record.name === "string") return record.name;
  return undefined;
}
