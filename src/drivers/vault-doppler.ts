/**
 * Doppler backend for the `managed` vault driver.
 *
 * Talks to the Doppler REST API over `fetch` — no optional peer. A service
 * token already embeds project + config; a personal token needs
 * `OKE_VAULT_MOUNT=project/config`.
 */

import { VaultError } from "../elements/vault/errors.ts";
import { openRemoteSecretBag, vaultHttpJson, type RemoteSecretClient } from "./vault-remote-bag.ts";
import type { VaultBag } from "./vault-types.ts";

/** Default Doppler API origin. */
const DOPPLER_API = "https://api.doppler.com";

/** Options for {@link openDopplerBag}. */
export interface OpenDopplerOptions {
  /** Service or personal token (`OKE_VAULT_TOKEN`). */
  readonly token?: string;
  /** API origin override (tests / private endpoints). */
  readonly url?: string;
  /** `project/config` when the token does not embed them. */
  readonly mount?: string;
  /** Injected client for tests — skips HTTP entirely. */
  readonly client?: RemoteSecretClient;
  /** Declared names, used as the read set when list is denied. */
  readonly secrets?: Readonly<Record<string, string>>;
  /** Fetch override for tests. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Open a secret bag backed by Doppler.
 *
 * @param options - Token / mount / injected client / fetch
 * @throws VaultError `BACKEND_ERROR` when the token is missing or the API rejects the read
 */
export async function openDopplerBag(options: OpenDopplerOptions = {}): Promise<VaultBag> {
  const client =
    options.client ??
    connectDoppler({
      token: options.token,
      url: options.url,
      mount: options.mount,
      fetch: options.fetch ?? globalThis.fetch,
    });
  return openRemoteSecretBag({
    client,
    ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
    label: "doppler",
  });
}

/** Options for the live Doppler client. */
interface ConnectDopplerOptions {
  readonly token: string | undefined;
  readonly url: string | undefined;
  readonly mount: string | undefined;
  readonly fetch: typeof fetch;
}

/**
 * Build a REST client over Doppler's config-secrets API.
 *
 * @param options - Token / origin / mount / fetch
 */
function connectDoppler(options: ConnectDopplerOptions): RemoteSecretClient {
  const token = options.token?.trim() ?? "";
  if (token.length === 0) {
    throw new VaultError(
      "BACKEND_ERROR",
      'vault: managed provider "doppler" needs OKE_VAULT_TOKEN (service or personal token)',
    );
  }
  const origin = normalizeOrigin(options.url ?? DOPPLER_API);
  const query = dopplerQuery(options.mount);
  const fetchFn = options.fetch;
  let cache: Map<string, string> | undefined;

  /**
   * Load the full config map once; later list/get share it.
   */
  async function load(): Promise<Map<string, string>> {
    if (cache) return cache;
    const { body } = await vaultHttpJson(
      fetchFn,
      `${origin}/v3/configs/config/secrets${query}`,
      { headers: dopplerHeaders(token) },
      "vault: doppler list failed",
    );
    cache = parseDopplerSecrets(body);
    return cache;
  }

  return {
    async list() {
      return [...(await load()).keys()];
    },
    async get(name) {
      return (await load()).get(name);
    },
    async put(name, value) {
      await vaultHttpJson(
        fetchFn,
        `${origin}/v3/configs/config/secrets${query}`,
        {
          method: "POST",
          headers: dopplerHeaders(token),
          body: JSON.stringify({ secrets: { [name]: value } }),
        },
        `vault: doppler write of "${name}" failed`,
      );
      cache?.set(name, value);
    },
    async remove(name) {
      await vaultHttpJson(
        fetchFn,
        `${origin}/v3/configs/config/secrets${query}`,
        {
          method: "POST",
          headers: dopplerHeaders(token),
          body: JSON.stringify({ secrets: { [name]: null } }),
        },
        `vault: doppler delete of "${name}" failed`,
      );
      cache?.delete(name);
    },
  };
}

/**
 * Auth + JSON headers for Doppler.
 *
 * @param token - Bearer token
 */
function dopplerHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/**
 * `project/config` query string, or empty when a service token embeds them.
 *
 * @param mount - `OKE_VAULT_MOUNT`
 */
function dopplerQuery(mount: string | undefined): string {
  const raw = mount?.trim() ?? "";
  if (raw.length === 0) return "";
  const slash = raw.indexOf("/");
  if (slash <= 0 || slash === raw.length - 1) {
    throw new VaultError(
      "INVALID_PATH",
      "vault: doppler OKE_VAULT_MOUNT must be project/config (or omit it for a service token)",
    );
  }
  const project = raw.slice(0, slash);
  const config = raw.slice(slash + 1);
  return `?project=${encodeURIComponent(project)}&config=${encodeURIComponent(config)}`;
}

/**
 * Strip a trailing slash from an API origin.
 *
 * @param url - Origin or origin + path
 */
function normalizeOrigin(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Pull raw/computed string values out of Doppler's secrets object.
 *
 * @param body - JSON body
 */
function parseDopplerSecrets(body: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (typeof body !== "object" || body === null) return map;
  const secrets = (body as { secrets?: unknown }).secrets;
  if (typeof secrets !== "object" || secrets === null) return map;
  for (const [name, entry] of Object.entries(secrets)) {
    const value = dopplerValue(entry);
    if (value !== undefined) map.set(name, value);
  }
  return map;
}

/**
 * Prefer `raw`, then `computed`, then a bare string.
 *
 * @param entry - One Doppler secret record
 */
function dopplerValue(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (typeof entry !== "object" || entry === null) return undefined;
  const record = entry as { raw?: unknown; computed?: unknown };
  if (typeof record.raw === "string") return record.raw;
  if (typeof record.computed === "string") return record.computed;
  return undefined;
}
