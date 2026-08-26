/**
 * Smoke tests for the AS crypto layer — ES256 sign/verify, DPoP mint/verify,
 * thumbprints. These exercise the WebCrypto paths end to end.
 */

import { describe, expect, test } from "bun:test";
import {
  createAsKeyStore,
  createDpopSigner,
  decodeDpopProof,
  jwkThumbprint,
  signAccessToken,
  verifyDpopProof,
  verifySignedJwt,
  type OAuthAccessClaims,
} from "./crypto.ts";

const T0 = 1_700_000_000_000;

describe("oauth-as crypto", () => {
  test("sign + verify ES256 access token roundtrip", async () => {
    const keys = createAsKeyStore();
    const claims: OAuthAccessClaims = {
      iss: "https://as.example.com",
      sub: "user-1",
      client_id: "https://app.example.com/cimd.json",
      aud: "https://mcp.example.com/mcp",
      scope: "mcp:tools",
      iat: Math.floor(T0 / 1000),
      exp: Math.floor(T0 / 1000) + 600,
      jti: "jti-1",
      cnf: { jkt: "thumb" },
    };
    const token = await signAccessToken(keys, claims);
    const decoded = await verifySignedJwt<OAuthAccessClaims>(keys, token);
    expect(decoded.sub).toBe("user-1");
    expect(decoded.aud).toBe("https://mcp.example.com/mcp");
    expect(decoded.cnf?.jkt).toBe("thumb");
  });

  test("tampered payload is rejected", async () => {
    const keys = createAsKeyStore();
    const token = await signAccessToken(keys, {
      iss: "iss",
      sub: "s",
      client_id: "c",
      aud: "a",
      scope: "x",
      iat: 1,
      exp: 2,
      jti: "j",
    });
    const parts = token.split(".");
    const forged = `${parts[0]}.${btoa(JSON.stringify({ evil: true }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")}.${parts[2]}`;
    await expect(verifySignedJwt(keys, forged)).rejects.toThrow();
  });

  test("DPoP proof verifies and binds htm/htu/ath", async () => {
    const signer = await createDpopSigner();
    const accessToken = "some-access-token";
    const proof = await signer.prove({
      htm: "POST",
      htu: "https://as.example.com/oauth/token?x=1#frag",
      now: T0,
      accessToken,
    });
    const { header } = decodeDpopProof(proof);
    const jktFromHeader = await jwkThumbprint(header.jwk ?? {});
    const jwk = await verifyDpopProof(proof, {
      htm: "POST",
      htu: "https://as.example.com/oauth/token",
      now: T0,
      accessToken,
    });
    expect(await jwkThumbprint(jwk)).toBe(jktFromHeader);
    // Wrong method rejected.
    await expect(
      verifyDpopProof(proof, { htm: "GET", htu: "https://as.example.com/oauth/token", now: T0 }),
    ).rejects.toThrow(/htm/);
    // Stale proof (outside skew window) rejected.
    await expect(
      verifyDpopProof(proof, {
        htm: "POST",
        htu: "https://as.example.com/oauth/token",
        now: T0 + 10 * 60_000,
      }),
    ).rejects.toThrow(/iat/);
  });

  test("jwks exposes the active key", async () => {
    const keys = createAsKeyStore();
    await keys.generate();
    const set = keys.jwks();
    expect(set.keys.length).toBe(1);
    expect(set.keys[0]?.kty).toBe("EC");
    expect(typeof set.keys[0]?.kid).toBe("string");
  });
});
