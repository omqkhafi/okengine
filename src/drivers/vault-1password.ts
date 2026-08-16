/**
 * 1Password Connect backend for the `managed` vault driver.
 *
 * Talks to a Connect server over `fetch` — no optional peer.
 * `OKE_VAULT_URL` is the Connect host, `OKE_VAULT_TOKEN` the Connect token,
 * `OKE_VAULT_MOUNT` the vault name or UUID.
 */

import { VaultError } from "../elements/vault/errors.ts";
import { openRemoteSecretBag, vaultHttpJson, type RemoteSecretClient } from "./vault-remote-bag.ts";
import type { VaultBag } from "./vault-types.ts";

/** Options for {@link openOnePasswordBag}. */
export interface OpenOnePasswordOptions {
  /** Connect host (`http://connect:8080`). */
  readonly url?: string;
  /** Connect token. */
  readonly token?: string;
  /** Vault name or UUID. */
  readonly mount?: string;
  /** Injected client for tests — skips HTTP entirely. */
  readonly client?: RemoteSecretClient;
  /** Declared names, used as the read set when list is denied. */
  readonly secrets?: Readonly<Record<string, string>>;
  /** Fetch override for tests. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Open a secret bag backed by 1Password Connect.
 *
 * @param options - Host / token / vault / injected client / fetch
 * @throws VaultError `BACKEND_ERROR` when connection fields are missing or the API rejects the read
 */
export async function openOnePasswordBag(options: OpenOnePasswordOptions = {}): Promise<VaultBag> {
  const client =
    options.client ??
    (await connectOnePassword({
      url: options.url,
      token: options.token,
      mount: options.mount,
      fetch: options.fetch ?? globalThis.fetch,
    }));
  return openRemoteSecretBag({
    client,
    ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
    label: "1password",
  });
}

/** Options for the live Connect client. */
interface ConnectOnePasswordOptions {
  readonly url: string | undefined;
  readonly token: string | undefined;
  readonly mount: string | undefined;
  readonly fetch: typeof fetch;
}

/** Connect vault summary. */
interface ConnectVault {
  readonly id?: string;
  readonly name?: string;
}

/** Connect item summary / detail. */
interface ConnectItem {
  readonly id?: string;
  readonly title?: string;
  readonly category?: string;
  readonly fields?: readonly ConnectField[];
}

/** One field on a Connect item. */
interface ConnectField {
  readonly id?: string;
  readonly type?: string;
  readonly label?: string;
  readonly value?: string;
}

/**
 * Build a REST client over a 1Password Connect server.
 *
 * @param options - Host / token / vault / fetch
 */
async function connectOnePassword(options: ConnectOnePasswordOptions): Promise<RemoteSecretClient> {
  const origin = normalizeConnectOrigin(options.url);
  const token = options.token?.trim() ?? "";
  const mount = options.mount?.trim() ?? "";
  if (origin.length === 0) {
    throw new VaultError(
      "BACKEND_ERROR",
      'vault: managed provider "1password" needs OKE_VAULT_URL (Connect host)',
    );
  }
  if (token.length === 0) {
    throw new VaultError(
      "BACKEND_ERROR",
      'vault: managed provider "1password" needs OKE_VAULT_TOKEN (Connect token)',
    );
  }
  if (mount.length === 0) {
    throw new VaultError(
      "BACKEND_ERROR",
      'vault: managed provider "1password" needs OKE_VAULT_MOUNT (vault name or UUID)',
    );
  }

  const fetchFn = options.fetch;
  const vaultId = await resolveVaultId(fetchFn, origin, token, mount);
  const itemsUrl = `${origin}/v1/vaults/${encodeURIComponent(vaultId)}/items`;

  /**
   * GET one item; 404 is a miss.
   *
   * @param itemId - Connect item UUID
   */
  async function readItem(itemId: string): Promise<ConnectItem | undefined> {
    const { status, body } = await vaultHttpJson(
      fetchFn,
      `${itemsUrl}/${encodeURIComponent(itemId)}`,
      { headers: connectHeaders(token) },
      `vault: 1password read of item failed`,
      { allow: [404] },
    );
    if (status === 404) return undefined;
    return asConnectItem(body);
  }

  return {
    async list() {
      const { body } = await vaultHttpJson(
        fetchFn,
        itemsUrl,
        { headers: connectHeaders(token) },
        "vault: 1password list failed",
      );
      const names: string[] = [];
      for (const item of asConnectItemList(body)) {
        if (item.title !== undefined && item.title.length > 0) names.push(item.title);
      }
      return names;
    },
    async get(name) {
      const itemId = await findItemId(fetchFn, itemsUrl, token, name);
      if (itemId === undefined) return undefined;
      const item = await readItem(itemId);
      return item === undefined ? undefined : itemValue(item);
    },
    async put(name, value) {
      const existingId = await findItemId(fetchFn, itemsUrl, token, name);
      if (existingId === undefined) {
        await vaultHttpJson(
          fetchFn,
          itemsUrl,
          {
            method: "POST",
            headers: connectHeaders(token),
            body: JSON.stringify(newCredentialItem(name, value)),
          },
          `vault: 1password write of "${name}" failed`,
        );
        return;
      }
      const current = await readItem(existingId);
      const next = replaceItemValue(current ?? { title: name }, value);
      await vaultHttpJson(
        fetchFn,
        `${itemsUrl}/${encodeURIComponent(existingId)}`,
        {
          method: "PUT",
          headers: connectHeaders(token),
          body: JSON.stringify({ ...next, id: existingId }),
        },
        `vault: 1password write of "${name}" failed`,
      );
    },
    async remove(name) {
      const itemId = await findItemId(fetchFn, itemsUrl, token, name);
      if (itemId === undefined) return;
      await vaultHttpJson(
        fetchFn,
        `${itemsUrl}/${encodeURIComponent(itemId)}`,
        { method: "DELETE", headers: connectHeaders(token) },
        `vault: 1password delete of "${name}" failed`,
        { allow: [404] },
      );
    },
  };
}

/**
 * Resolve a vault name or UUID to a Connect vault id.
 *
 * @param fetchFn - Fetch
 * @param origin - Connect origin
 * @param token - Connect token
 * @param mount - Name or UUID
 */
async function resolveVaultId(
  fetchFn: typeof fetch,
  origin: string,
  token: string,
  mount: string,
): Promise<string> {
  const { body } = await vaultHttpJson(
    fetchFn,
    `${origin}/v1/vaults`,
    { headers: connectHeaders(token) },
    "vault: 1password vault list failed",
  );
  const vaults = asConnectVaultList(body);
  const match = vaults.find(
    (vault) => vault.id === mount || vault.name?.toLowerCase() === mount.toLowerCase(),
  );
  if (match?.id === undefined) {
    throw new VaultError("BACKEND_ERROR", `vault: 1password vault "${mount}" not found`);
  }
  return match.id;
}

/**
 * Find an item UUID by title (exact match).
 *
 * @param fetchFn - Fetch
 * @param itemsUrl - Vault items collection
 * @param token - Connect token
 * @param title - Bag name
 */
async function findItemId(
  fetchFn: typeof fetch,
  itemsUrl: string,
  token: string,
  title: string,
): Promise<string | undefined> {
  const { body } = await vaultHttpJson(
    fetchFn,
    itemsUrl,
    { headers: connectHeaders(token) },
    `vault: 1password lookup of "${title}" failed`,
  );
  const match = asConnectItemList(body).find((item) => item.title === title);
  return match?.id;
}

/**
 * Auth + JSON headers for Connect.
 *
 * @param token - Bearer token
 */
function connectHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

/**
 * Strip a trailing slash and an optional `/v1` suffix from the Connect host.
 *
 * @param url - Host as given
 */
function normalizeConnectOrigin(url: string | undefined): string {
  const raw = url?.trim() ?? "";
  if (raw.length === 0) return "";
  return raw.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

/**
 * New API-credential item with one concealed field.
 *
 * @param title - Bag name
 * @param value - Cleartext
 */
function newCredentialItem(title: string, value: string): ConnectItem {
  return {
    title,
    category: "API_CREDENTIAL",
    fields: [{ id: "credential", type: "CONCEALED", label: "credential", value }],
  };
}

/**
 * Prefer a concealed field, then any field with a string value.
 *
 * @param item - Connect item
 */
function itemValue(item: ConnectItem): string | undefined {
  const fields = item.fields ?? [];
  const concealed = fields.find(
    (field) => field.type === "CONCEALED" && typeof field.value === "string",
  );
  if (concealed?.value !== undefined) return concealed.value;
  const labeled = fields.find(
    (field) =>
      (field.label === "credential" || field.label === "password") &&
      typeof field.value === "string",
  );
  if (labeled?.value !== undefined) return labeled.value;
  return fields.find((field) => typeof field.value === "string" && field.value.length > 0)?.value;
}

/**
 * Overwrite the concealed/credential field, or append one.
 *
 * @param item - Existing item
 * @param value - New cleartext
 */
function replaceItemValue(item: ConnectItem, value: string): ConnectItem {
  const fields = [...(item.fields ?? [])];
  const index = fields.findIndex(
    (field) =>
      field.type === "CONCEALED" || field.label === "credential" || field.label === "password",
  );
  if (index === -1) {
    fields.push({ id: "credential", type: "CONCEALED", label: "credential", value });
  } else {
    const current = fields[index];
    if (current !== undefined) fields[index] = { ...current, value };
  }
  return { ...item, fields };
}

/**
 * Narrow a JSON body to a vault list.
 *
 * @param body - JSON
 */
function asConnectVaultList(body: unknown): readonly ConnectVault[] {
  return Array.isArray(body) ? (body as ConnectVault[]) : [];
}

/**
 * Narrow a JSON body to an item list.
 *
 * @param body - JSON
 */
function asConnectItemList(body: unknown): readonly ConnectItem[] {
  return Array.isArray(body) ? (body as ConnectItem[]) : [];
}

/**
 * Narrow a JSON body to one item.
 *
 * @param body - JSON
 */
function asConnectItem(body: unknown): ConnectItem {
  if (typeof body === "object" && body !== null) return body as ConnectItem;
  return {};
}
