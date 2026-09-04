/**
 * Defense-in-depth: session access JWT must allowlist HS256 and reject
 * spoofed alg headers / non-JWS compact shapes (JWE = 5 parts).
 */

import { describe, expect, test } from "bun:test";
import {
  createSessionStore,
  issueSession,
  SessionError,
  verifyAccess,
} from "./sessions.ts";

const SECRET = "test-secret-at-least-32-bytes-long!!";

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256B64url(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  let bin = "";
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("session access JWT alg enforcement", () => {
  test("rejects alg: none", async () => {
    const store = createSessionStore();
    const header = b64url(JSON.stringify({ alg: "none", typ: "JWT" }));
    const payload = b64url(
      JSON.stringify({
        sub: "u1",
        plane: "user",
        sid: "s1",
        scopes: [],
        iat: 1,
        exp: 9_999_999_999_999,
      }),
    );
    const token = `${header}.${payload}.`;
    await expect(verifyAccess(store, SECRET, token)).rejects.toThrow(SessionError);
    await expect(verifyAccess(store, SECRET, token)).rejects.toThrow(
      "unsupported access token alg",
    );
  });

  test("rejects mismatched alg even when HMAC is valid", async () => {
    const store = createSessionStore();
    const now = 1_700_000_000_000;
    const issued = await issueSession(
      store,
      { secret: SECRET, now: () => now },
      { id: "u1", plane: "user", scopes: ["read"] },
    );
    const payloadPart = issued.accessToken.split(".")[1]!;
    const forgedHeader = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const data = `${forgedHeader}.${payloadPart}`;
    const sig = await hmacSha256B64url(SECRET, data);
    const forged = `${data}.${sig}`;
    await expect(verifyAccess(store, SECRET, forged, { now: () => now })).rejects.toThrow(
      SessionError,
    );
    await expect(verifyAccess(store, SECRET, forged, { now: () => now })).rejects.toThrow(
      "unsupported access token alg",
    );
  });

  test("rejects JWE compact serialization (5 parts)", async () => {
    const store = createSessionStore();
    const jwe = "a.b.c.d.e";
    await expect(verifyAccess(store, SECRET, jwe)).rejects.toThrow(SessionError);
    await expect(verifyAccess(store, SECRET, jwe)).rejects.toThrow("malformed access token");
  });
});
