/**
 * KMS unseal — injected seams, key hygiene, and the missing-peer message.
 */

import { describe, expect, test } from "bun:test";
import { deriveVerifyHash, generateMasterKey, MASTER_KEY_BYTES } from "./crypto.ts";
import { isVaultError } from "./errors.ts";
import { createAwsKmsUnsealer, wrapMasterWithAwsKms } from "./kms-unseal.ts";

const WRAPPED = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);

describe("aws kms unseal", () => {
  test("an injected decrypt yields a working unsealer", async () => {
    const masterKey = generateMasterKey();
    const unsealer = await createAwsKmsUnsealer({
      keyId: "alias/oke-vault",
      wrappedMaster: WRAPPED,
      decryptFn: async (ciphertext) => {
        expect([...ciphertext]).toEqual([...WRAPPED]);
        return Uint8Array.from(masterKey);
      },
    });

    expect(unsealer.sealed).toBe(false);
    expect(await unsealer.verifyHash()).toBe(await deriveVerifyHash(masterKey));
    unsealer.seal();
    expect(unsealer.sealed).toBe(true);
  });

  test("the plaintext handed back by kms is zeroed after import", async () => {
    const masterKey = generateMasterKey();
    const plaintext = Uint8Array.from(masterKey);
    const unsealer = await createAwsKmsUnsealer({
      keyId: "alias/oke-vault",
      wrappedMaster: WRAPPED,
      decryptFn: async () => plaintext,
    });

    expect([...plaintext]).toEqual(new Array<number>(MASTER_KEY_BYTES).fill(0));
    // The unsealer kept its own copy, so it still derives the real hash.
    expect(await unsealer.verifyHash()).toBe(await deriveVerifyHash(masterKey));
  });

  test("a wrong-length plaintext is rejected", async () => {
    const failure = await createAwsKmsUnsealer({
      keyId: "alias/oke-vault",
      wrappedMaster: WRAPPED,
      decryptFn: async () => new Uint8Array(16),
    }).catch((e: unknown) => e);

    expect(isVaultError(failure, "INVALID_KEY")).toBe(true);
  });

  test("wrapMasterWithAwsKms uses the injected encrypt and checks key length", async () => {
    const masterKey = generateMasterKey();
    const blob = await wrapMasterWithAwsKms("alias/oke-vault", masterKey, {
      encryptFn: async (plaintext) => Uint8Array.from([1, ...plaintext]),
    });

    expect(blob).toHaveLength(MASTER_KEY_BYTES + 1);
    const failure = await wrapMasterWithAwsKms("alias/oke-vault", new Uint8Array(8), {
      encryptFn: async (plaintext) => plaintext,
    }).catch((e: unknown) => e);
    expect(isVaultError(failure, "INVALID_KEY")).toBe(true);
  });

  test("without the optional peer the failure names the install command", async () => {
    const failure = await createAwsKmsUnsealer({
      keyId: "alias/oke-vault",
      wrappedMaster: WRAPPED,
    }).catch((e: unknown) => e);

    expect(isVaultError(failure, "MISSING_PEER")).toBe(true);
    expect((failure as Error).message).toContain("bun add @aws-sdk/client-kms");
  });
});
