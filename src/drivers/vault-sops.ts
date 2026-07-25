/**
 * `sops` vault driver — SOPS/age via Typage (`age-encryption`).
 *
 * Pure TypeScript, in-process. No Go `sops` / `age` binary.
 * Decrypts the SOPS data key with age, then AES-256-GCM value payloads.
 *
 * `age-encryption` is an optional peer — loaded only when this driver runs.
 */

import type {
  VaultBag,
  VaultDriver,
  VaultOpenOptions,
} from "./vault-types.ts";

/** Minimal Typage surface used by this driver. */
type AgeModule = typeof import("age-encryption");

/**
 * Lazy-load Typage so apps that never open a sops vault skip the dependency.
 */
async function loadAge(): Promise<AgeModule> {
  try {
    return await import("age-encryption");
  } catch {
    throw new Error(
      "sops vault: install optional peer `age-encryption` (bun add age-encryption)",
    );
  }
}

/** SOPS metadata block. */
interface SopsMeta {
  readonly age?: ReadonlyArray<{
    readonly recipient?: string;
    readonly enc?: string;
  }>;
  readonly mac?: string;
}

/** Encrypted value marker: `ENC[AES256_GCM,data:…,iv:…,tag:…,type:…]`. */
const ENC_RE =
  /^ENC\[AES256_GCM,data:(?<data>[^,]+),iv:(?<iv>[^,]+),tag:(?<tag>[^,]+),type:(?<type>[^\]]+)\]$/;

/**
 * Decode a URL-safe / standard base64 string to bytes.
 *
 * @param input - Base64 text
 */
function b64(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0
    ? normalized
    : normalized + "=".repeat(4 - (normalized.length % 4));
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Encode bytes as standard base64.
 *
 * @param bytes - Input
 */
function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/**
 * Copy into a fresh `Uint8Array` so Web Crypto accepts it as `BufferSource`.
 *
 * @param bytes - Input
 */
function asBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

/**
 * Decrypt a SOPS AES-256-GCM value with the data key.
 *
 * @param enc - `ENC[AES256_GCM,…]` string
 * @param dataKey - 32-byte SOPS data key
 */
async function decryptValue(
  enc: string,
  dataKey: Uint8Array,
): Promise<string> {
  const m = ENC_RE.exec(enc);
  const dataB64 = m?.groups?.data;
  const ivB64 = m?.groups?.iv;
  const tagB64 = m?.groups?.tag;
  if (!dataB64 || !ivB64 || !tagB64) {
    throw new Error(`sops: unrecognized ciphertext: ${enc.slice(0, 32)}…`);
  }
  const data = b64(dataB64);
  const iv = asBufferSource(b64(ivB64));
  const tag = b64(tagB64);
  const key = await crypto.subtle.importKey(
    "raw",
    asBufferSource(dataKey),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const cipher = new Uint8Array(data.length + tag.length);
  cipher.set(data, 0);
  cipher.set(tag, data.length);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    asBufferSource(cipher),
  );
  return new TextDecoder().decode(plain);
}

/**
 * Decrypt the SOPS data key from an age-encrypted stanza using Typage.
 *
 * @param identity - `AGE-SECRET-KEY-…`
 * @param encBlock - Armored age ciphertext from `sops.age[].enc`
 */
async function decryptDataKey(
  identity: string,
  encBlock: string,
): Promise<Uint8Array> {
  const age = await loadAge();
  const d = new age.Decrypter();
  d.addIdentity(identity.trim());
  const trimmed = encBlock.trim();
  const file: Uint8Array = trimmed.includes("BEGIN AGE ENCRYPTED FILE")
    ? age.armor.decode(trimmed)
    : new TextEncoder().encode(trimmed);
  const bytes = await d.decrypt(file, "uint8array");
  return bytes;
}

/**
 * Parse a SOPS JSON document into a name→ciphertext map + metadata.
 *
 * @param text - File contents
 */
function parseSopsJson(text: string): {
  values: Record<string, string>;
  meta: SopsMeta;
} {
  const doc = JSON.parse(text) as Record<string, unknown>;
  const meta = (doc.sops ?? {}) as SopsMeta;
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === "sops") continue;
    if (typeof v === "string") values[k] = v;
  }
  return { values, meta };
}

/**
 * Encrypt a plaintext with AES-256-GCM into a SOPS-shaped `ENC[…]` string.
 * Exported for tests that build fixtures without the Go CLI.
 *
 * @param plaintext - Cleartext
 * @param dataKey - 32-byte key
 */
export async function sopsEncryptValue(
  plaintext: string,
  dataKey: Uint8Array,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey(
    "raw",
    asBufferSource(dataKey),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const tag = cipher.slice(cipher.length - 16);
  const data = cipher.slice(0, cipher.length - 16);
  return `ENC[AES256_GCM,data:${b64encode(data)},iv:${b64encode(iv)},tag:${b64encode(tag)},type:str]`;
}

/**
 * Build a minimal SOPS JSON document encrypted to an age recipient.
 * Test / fixture helper — not a full `sops` replacement.
 *
 * @param secrets - Cleartext map
 * @param recipient - `age1…` recipient
 * @param dataKey - Optional 32-byte data key (random when omitted)
 */
export async function buildSopsFixture(
  secrets: Readonly<Record<string, string>>,
  recipient: string,
  dataKey?: Uint8Array,
): Promise<{ json: string; dataKey: Uint8Array }> {
  const age = await loadAge();
  const key = dataKey ?? crypto.getRandomValues(new Uint8Array(32));
  const e = new age.Encrypter();
  e.addRecipient(recipient);
  const encKey = await e.encrypt(key);
  const encBytes =
    typeof encKey === "string" ? new TextEncoder().encode(encKey) : encKey;
  const encArmored = age.armor.encode(encBytes);
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(secrets)) {
    out[name] = await sopsEncryptValue(value, key);
  }
  out.sops = {
    age: [{ recipient, enc: encArmored }],
    lastmodified: new Date().toISOString(),
    version: "3.8.0",
  };
  return { json: JSON.stringify(out, null, 2), dataKey: key };
}

/**
 * SOPS/age vault driver (Typage).
 */
export const sopsVaultDriver: VaultDriver = {
  id: "sops",
  async open(options: VaultOpenOptions = {}): Promise<VaultBag> {
    let text: string | undefined;
    if (typeof options.ciphertext === "string") {
      text = options.ciphertext;
    } else if (options.ciphertext instanceof Uint8Array) {
      text = new TextDecoder().decode(options.ciphertext);
    } else if (options.path) {
      text = await Bun.file(options.path).text();
    }
    if (!text) {
      throw new Error("sops vault: path or ciphertext is required");
    }
    if (!options.ageIdentity) {
      throw new Error(
        "sops vault: ageIdentity (AGE-SECRET-KEY-…) is required — Typage decrypts in-process",
      );
    }

    const { values, meta } = parseSopsJson(text);
    const stanza = meta.age?.[0]?.enc;
    if (!stanza) {
      throw new Error("sops vault: no age recipient stanza found");
    }
    const dataKey = await decryptDataKey(options.ageIdentity, stanza);
    const map = new Map<string, string>();
    for (const [name, enc] of Object.entries(values)) {
      if (enc.startsWith("ENC[")) {
        map.set(name, await decryptValue(enc, dataKey));
      } else {
        map.set(name, enc);
      }
    }

    return {
      driverId: "sops",
      get(name) {
        return map.get(name);
      },
      names() {
        return [...map.keys()];
      },
    };
  },
};
