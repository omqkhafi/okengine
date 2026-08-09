/**
 * AWS KMS unseal path — the master key never exists outside KMS at rest.
 *
 * At init the plaintext master key is sent to KMS `Encrypt` once; the
 * returned ciphertext blob is what gets stored (`oke_vault_master.wrapped_master`).
 * At boot the blob goes back to KMS `Decrypt` and the plaintext is handed
 * straight to an {@link Unsealer}, then zeroed — it is never written to disk,
 * an environment variable, or a log.
 *
 * `@aws-sdk/client-kms` is an optional peer, imported dynamically so a
 * project that unseals from `env` or a file never pays for it. Tests inject
 * `decryptFn` / `encryptFn` and skip the SDK entirely.
 */

import { MASTER_KEY_BYTES, zeroBytes } from "./crypto.ts";
import { VaultError } from "./errors.ts";
import { createEnvUnsealer, type Unsealer } from "./unseal.ts";

/** Package name of the optional peer, resolved at call time. */
const KMS_PACKAGE = "@aws-sdk/client-kms";

/** Options for {@link createAwsKmsUnsealer}. */
export interface CreateAwsKmsUnsealerOptions {
  /** KMS key id, alias, or ARN that wrapped the master key. */
  readonly keyId: string;
  /** Ciphertext blob returned by {@link wrapMasterWithAwsKms}. */
  readonly wrappedMaster: Uint8Array;
  /** AWS region. Falls back to the SDK's own resolution chain. */
  readonly region?: string;
  /** Decrypt seam for tests — skips the SDK import entirely. */
  readonly decryptFn?: (ciphertext: Uint8Array) => Promise<Uint8Array>;
}

/** Options for {@link wrapMasterWithAwsKms}. */
export interface WrapMasterWithAwsKmsOptions {
  /** AWS region. Falls back to the SDK's own resolution chain. */
  readonly region?: string;
  /** Encrypt seam for tests — skips the SDK import entirely. */
  readonly encryptFn?: (plaintext: Uint8Array) => Promise<Uint8Array>;
}

/** KMS response fields this module reads. */
interface KmsResult {
  readonly Plaintext?: Uint8Array;
  readonly CiphertextBlob?: Uint8Array;
}

/** Structural client interface — the SDK's `KMSClient` satisfies it. */
interface KmsClientLike {
  send(command: unknown): Promise<KmsResult>;
  destroy?(): void;
}

/** Constructors pulled off the dynamically imported module. */
interface KmsBindings {
  readonly KMSClient: new (config: { region?: string }) => KmsClientLike;
  readonly DecryptCommand: new (input: { KeyId: string; CiphertextBlob: Uint8Array }) => unknown;
  readonly EncryptCommand: new (input: { KeyId: string; Plaintext: Uint8Array }) => unknown;
}

/**
 * Unseal from a KMS-wrapped master key.
 *
 * @param opts - Key id, wrapped blob, region, and the test decrypt seam
 * @throws VaultError `MISSING_PEER` when `@aws-sdk/client-kms` is absent
 * @throws VaultError `INVALID_KEY` when KMS returns something other than 32 bytes
 */
export async function createAwsKmsUnsealer(opts: CreateAwsKmsUnsealerOptions): Promise<Unsealer> {
  const decrypt = opts.decryptFn ?? (await bindDecrypt(opts.keyId, opts.region));
  const plaintext = await decrypt(opts.wrappedMaster);
  try {
    if (plaintext.byteLength !== MASTER_KEY_BYTES) {
      throw new VaultError(
        "INVALID_KEY",
        `vault: kms master key must be ${MASTER_KEY_BYTES} bytes`,
      );
    }
    return createEnvUnsealer(plaintext);
  } finally {
    zeroBytes(plaintext);
  }
}

/**
 * Wrap a freshly generated master key with KMS for storage at init.
 *
 * The caller still owns `masterKey` and must zero it afterwards.
 *
 * @param keyId - KMS key id, alias, or ARN
 * @param masterKey - Raw 32-byte master key
 * @param opts - Region and the test encrypt seam
 * @throws VaultError `MISSING_PEER` when `@aws-sdk/client-kms` is absent
 */
export async function wrapMasterWithAwsKms(
  keyId: string,
  masterKey: Uint8Array,
  opts: WrapMasterWithAwsKmsOptions = {},
): Promise<Uint8Array> {
  if (masterKey.byteLength !== MASTER_KEY_BYTES) {
    throw new VaultError("INVALID_KEY", `vault: master key must be ${MASTER_KEY_BYTES} bytes`);
  }
  if (opts.encryptFn) return opts.encryptFn(masterKey);

  const { KMSClient, EncryptCommand } = await loadKms();
  const client = new KMSClient(opts.region === undefined ? {} : { region: opts.region });
  try {
    const result = await client.send(new EncryptCommand({ KeyId: keyId, Plaintext: masterKey }));
    const blob = result.CiphertextBlob;
    if (!blob || blob.byteLength === 0) {
      throw new VaultError("BACKEND_ERROR", "vault: kms returned an empty ciphertext blob");
    }
    return new Uint8Array(blob);
  } catch (error) {
    if (error instanceof VaultError) throw error;
    // Never surface the SDK error: it can echo request payloads.
    throw new VaultError("BACKEND_ERROR", "vault: kms encrypt failed");
  } finally {
    client.destroy?.();
  }
}

/**
 * Build a decrypt closure backed by a real KMS client.
 *
 * @param keyId - KMS key id, alias, or ARN
 * @param region - AWS region
 */
async function bindDecrypt(
  keyId: string,
  region: string | undefined,
): Promise<(ciphertext: Uint8Array) => Promise<Uint8Array>> {
  const { KMSClient, DecryptCommand } = await loadKms();
  return async (ciphertext: Uint8Array) => {
    const client = new KMSClient(region === undefined ? {} : { region });
    try {
      const result = await client.send(
        new DecryptCommand({ KeyId: keyId, CiphertextBlob: ciphertext }),
      );
      const plaintext = result.Plaintext;
      if (!plaintext || plaintext.byteLength === 0) {
        throw new VaultError("BACKEND_ERROR", "vault: kms returned an empty plaintext");
      }
      return new Uint8Array(plaintext);
    } catch (error) {
      if (error instanceof VaultError) throw error;
      // Never surface the SDK error: it can echo key material or ciphertext.
      throw new VaultError("BACKEND_ERROR", "vault: kms decrypt failed");
    } finally {
      client.destroy?.();
    }
  };
}

/**
 * Import the optional `@aws-sdk/client-kms` peer.
 *
 * @throws VaultError `MISSING_PEER` with the exact install command
 */
async function loadKms(): Promise<KmsBindings> {
  // Indirect specifier: the peer is optional, so it must not become a
  // static dependency of the module graph.
  const specifier: string = KMS_PACKAGE;
  let mod: unknown;
  try {
    mod = await import(specifier);
  } catch {
    throw new VaultError("MISSING_PEER", `Install peer: bun add ${KMS_PACKAGE}`);
  }
  const bindings = mod as Partial<KmsBindings>;
  if (!bindings.KMSClient || !bindings.DecryptCommand || !bindings.EncryptCommand) {
    throw new VaultError(
      "MISSING_PEER",
      `vault: \`${KMS_PACKAGE}\` is installed but does not export KMSClient / DecryptCommand / EncryptCommand`,
    );
  }
  return {
    KMSClient: bindings.KMSClient,
    DecryptCommand: bindings.DecryptCommand,
    EncryptCommand: bindings.EncryptCommand,
  };
}
