/**
 * OTP seal — HKDF domain separation + AES-GCM round-trip.
 */

import { describe, expect, test } from "bun:test";
import { deriveOtpSealKey, OTP_SEAL_HKDF_INFO, sealOtp, unsealOtp } from "./otp-seal.ts";

describe("otp-seal", () => {
  test("info constant is the literal oke-otp-seal-v1", () => {
    expect(OTP_SEAL_HKDF_INFO).toBe("oke-otp-seal-v1");
  });

  test("round-trip seal / unseal", async () => {
    const secret = "test-secret-at-least-16";
    const otp = "482913";
    const blob = await sealOtp(secret, otp);
    expect(blob).not.toContain(otp);
    expect(await unsealOtp(secret, blob)).toBe(otp);
  });

  test("secret A cannot unseal secret B", async () => {
    const blob = await sealOtp("secret-aaaaaaaaaaaa", "123456");
    await expect(unsealOtp("secret-bbbbbbbbbbbb", blob)).rejects.toThrow();
  });

  test("deriveOtpSealKey produces an AES-GCM key (not raw secret)", async () => {
    const key = await deriveOtpSealKey("test-secret-at-least-16");
    expect(key.type).toBe("secret");
    expect(key.algorithm).toMatchObject({ name: "AES-GCM" });
    // Non-extractable — raw secret bytes never leave HKDF as exportable AES material.
    expect(key.extractable).toBe(false);
  });

  test("HKDF info bytes pin domain separation (known key length)", async () => {
    const ikm = new TextEncoder().encode("fixed-secret-for-vector");
    const baseKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info: new TextEncoder().encode(OTP_SEAL_HKDF_INFO),
      },
      baseKey,
      256,
    );
    expect(new Uint8Array(bits).byteLength).toBe(32);
    // Different info → different bits
    const other = await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(0),
        info: new TextEncoder().encode("session-hmac-v1"),
      },
      baseKey,
      256,
    );
    expect(Buffer.from(bits).equals(Buffer.from(other))).toBe(false);
  });
});
