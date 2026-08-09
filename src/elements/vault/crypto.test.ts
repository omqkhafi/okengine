/**
 * Vault crypto — envelope round-trip, AAD binding, path safety, seal physics.
 */

import { describe, expect, test } from "bun:test";
import {
  buildAad,
  constantTimeEqualBytes,
  decryptSecret,
  deriveBackupKek,
  deriveKek,
  deriveVerifyHash,
  encryptSecret,
  generateDek,
  generateMasterKey,
  importAesKey,
  masterKeyFromBase64,
  masterKeyToBase64,
  unwrapDek,
  wrapDek,
  zeroBytes,
  ALGORITHM,
  GCM_IV_BYTES,
  GCM_TAG_BYTES,
  MASTER_KEY_BYTES,
} from "./crypto.ts";
import { canonicalizePath } from "./path.ts";
import { isVaultError, VaultError } from "./errors.ts";
import { createEnvUnsealer, createMemoryUnsealer } from "./unseal.ts";

const PATH = "prod/api/stripe";
const VALUE = "sk_live_do_not_log_me";

describe("vault crypto envelope", () => {
  test("encrypt/decrypt round-trips a secret", async () => {
    const dek = await importAesKey(generateDek());
    const aad = buildAad(PATH, 1, ALGORITHM, 1);

    const sealed = await encryptSecret(dek, VALUE, aad);
    expect(sealed.iv).toHaveLength(GCM_IV_BYTES);
    expect(sealed.tag).toHaveLength(GCM_TAG_BYTES);
    expect(Buffer.from(sealed.ciphertext).toString("utf8")).not.toContain("sk_live");

    expect(await decryptSecret(dek, sealed, aad)).toBe(VALUE);
  });

  test("a different DEK cannot decrypt", async () => {
    const dek = await importAesKey(generateDek());
    const other = await importAesKey(generateDek());
    const aad = buildAad(PATH, 1, ALGORITHM, 1);
    const sealed = await encryptSecret(dek, VALUE, aad);

    await expect(decryptSecret(other, sealed, aad)).rejects.toThrow(VaultError);
    const failure = await decryptSecret(other, sealed, aad).catch((e: unknown) => e);
    expect(isVaultError(failure, "INVALID_KEY")).toBe(true);
  });

  test("AAD tampering fails — path, version, and kek generation are bound", async () => {
    const dek = await importAesKey(generateDek());
    const aad = buildAad(PATH, 1, ALGORITHM, 1);
    const sealed = await encryptSecret(dek, VALUE, aad);

    await expect(
      decryptSecret(dek, sealed, buildAad("prod/api/other", 1, ALGORITHM, 1)),
    ).rejects.toThrow(VaultError);
    await expect(decryptSecret(dek, sealed, buildAad(PATH, 2, ALGORITHM, 1))).rejects.toThrow(
      VaultError,
    );
    await expect(decryptSecret(dek, sealed, buildAad(PATH, 1, ALGORITHM, 2))).rejects.toThrow(
      VaultError,
    );
  });

  test("ciphertext tampering fails", async () => {
    const dek = await importAesKey(generateDek());
    const aad = buildAad(PATH, 1, ALGORITHM, 1);
    const sealed = await encryptSecret(dek, VALUE, aad);
    const flipped = Uint8Array.from(sealed.ciphertext);
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;

    await expect(decryptSecret(dek, { ...sealed, ciphertext: flipped }, aad)).rejects.toThrow(
      VaultError,
    );
  });

  test("DEK wrap/unwrap round-trips under the KEK", async () => {
    const masterKey = generateMasterKey();
    const kek = await deriveKek(masterKey);
    const dek = generateDek();
    const aad = buildAad(PATH, 1, ALGORITHM, 1);

    const wrapped = await wrapDek(kek, dek, aad);
    const unwrapped = await unwrapDek(kek, wrapped, aad);
    expect(constantTimeEqualBytes(unwrapped, dek)).toBe(true);

    const otherKek = await deriveKek(generateMasterKey());
    await expect(unwrapDek(otherKek, wrapped, aad)).rejects.toThrow(VaultError);
  });

  test("kek and backup kek are domain-separated", async () => {
    const masterKey = generateMasterKey();
    const kek = await deriveKek(masterKey);
    const backupKek = await deriveBackupKek(masterKey);
    const aad = buildAad(PATH, 1, ALGORITHM, 1);
    const wrapped = await wrapDek(kek, generateDek(), aad);

    await expect(unwrapDek(backupKek, wrapped, aad)).rejects.toThrow(VaultError);
  });

  test("verify hash is stable per key and differs across keys", async () => {
    const masterKey = generateMasterKey();
    const hash = await deriveVerifyHash(masterKey);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await deriveVerifyHash(masterKey)).toBe(hash);
    expect(await deriveVerifyHash(generateMasterKey())).not.toBe(hash);
    expect(hash).not.toBe(Buffer.from(masterKey).toString("hex"));
  });

  test("master key base64 helpers round-trip and reject short keys", () => {
    const masterKey = generateMasterKey();
    const encoded = masterKeyToBase64(masterKey);
    expect(constantTimeEqualBytes(masterKeyFromBase64(encoded), masterKey)).toBe(true);
    expect(() => masterKeyFromBase64("dG9vLXNob3J0")).toThrow(VaultError);
    expect(() => masterKeyFromBase64("")).toThrow(VaultError);
  });

  test("constantTimeEqualBytes and zeroBytes", () => {
    const a = Uint8Array.from([1, 2, 3, 4]);
    const b = Uint8Array.from([1, 2, 3, 4]);
    const c = Uint8Array.from([1, 2, 3, 5]);
    expect(constantTimeEqualBytes(a, b)).toBe(true);
    expect(constantTimeEqualBytes(a, c)).toBe(false);
    expect(constantTimeEqualBytes(a, Uint8Array.from([1, 2, 3]))).toBe(false);

    zeroBytes(a);
    expect([...a]).toEqual([0, 0, 0, 0]);
  });
});

describe("vault path canonicalization", () => {
  test("normalizes to a slash-joined key with no leading slash", () => {
    expect(canonicalizePath("prod/api/stripe")).toBe("prod/api/stripe");
    expect(canonicalizePath("  /prod//api///stripe/  ")).toBe("prod/api/stripe");
  });

  test("rejects traversal, NUL bytes, backslashes, and empties", () => {
    for (const bad of ["", "   ", "/", "prod/../root", "..", "prod/./api", "prod\\api"]) {
      expect(() => canonicalizePath(bad)).toThrow(VaultError);
    }
    expect(() => canonicalizePath("prod/api\0/stripe")).toThrow(VaultError);
    const failure = ((): unknown => {
      try {
        canonicalizePath("prod/../etc");
      } catch (e: unknown) {
        return e;
      }
      return undefined;
    })();
    expect(isVaultError(failure, "INVALID_PATH")).toBe(true);
  });

  test("rejects paths longer than 512 characters", () => {
    expect(() => canonicalizePath("a".repeat(513))).toThrow(VaultError);
    expect(canonicalizePath("a".repeat(512))).toHaveLength(512);
  });
});

describe("vault unsealer", () => {
  test("derives keys until sealed, then zeroes its master key", async () => {
    const masterKey = generateMasterKey();
    const unsealer = createEnvUnsealer(masterKey);

    expect(unsealer.sealed).toBe(false);
    expect(await unsealer.verifyHash()).toBe(await deriveVerifyHash(masterKey));

    const kek = await unsealer.unwrapKek();
    const aad = buildAad(PATH, 1, ALGORITHM, 1);
    const wrapped = await wrapDek(kek, generateDek(), aad);

    unsealer.seal();
    expect(unsealer.sealed).toBe(true);
    await expect(unsealer.unwrapKek()).rejects.toThrow(VaultError);
    await expect(unsealer.unwrapBackupKek()).rejects.toThrow(VaultError);
    await expect(unsealer.verifyHash()).rejects.toThrow(VaultError);

    const failure = await unsealer.unwrapKek().catch((e: unknown) => e);
    expect(isVaultError(failure, "SEALED")).toBe(true);

    // A KEK derived from an all-zero key must not unwrap live material.
    const zeroKek = await deriveKek(new Uint8Array(MASTER_KEY_BYTES));
    await expect(unwrapDek(zeroKek, wrapped, aad)).rejects.toThrow(VaultError);
  });

  test("seal is idempotent and copies the caller's buffer", async () => {
    const masterKey = generateMasterKey();
    const unsealer = createMemoryUnsealer(masterKey);
    zeroBytes(masterKey);

    // Zeroing the caller's buffer must not affect the unsealer's copy.
    expect(await unsealer.verifyHash()).not.toBe(
      await deriveVerifyHash(new Uint8Array(MASTER_KEY_BYTES)),
    );

    unsealer.seal();
    unsealer.seal();
    expect(unsealer.sealed).toBe(true);
  });

  test("rejects a master key of the wrong length", () => {
    expect(() => createMemoryUnsealer(new Uint8Array(16))).toThrow(VaultError);
  });
});

describe("VaultError", () => {
  test("carries a code and never a cause", () => {
    const error = new VaultError("SEALED", "vault: sealed");
    expect(error.code).toBe("SEALED");
    expect(error.name).toBe("VaultError");
    expect(error).toBeInstanceOf(Error);
    expect("cause" in error && error.cause !== undefined).toBe(false);
  });

  test("decryption failures do not attach the underlying crypto error", async () => {
    const dek = await importAesKey(generateDek());
    const other = await importAesKey(generateDek());
    const aad = buildAad(PATH, 1, ALGORITHM, 1);
    const sealed = await encryptSecret(dek, VALUE, aad);

    const failure = (await decryptSecret(other, sealed, aad).catch(
      (e: unknown) => e,
    )) as VaultError;
    expect(isVaultError(failure, "INVALID_KEY")).toBe(true);
    expect(failure.cause).toBeUndefined();
    expect(failure.message).not.toContain(VALUE);
  });
});
