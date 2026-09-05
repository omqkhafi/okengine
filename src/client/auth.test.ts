/**
 * Auth helpers tests — session subscribe, createAuthClient secure defaults.
 */

import { describe, expect, test } from "bun:test";
import {
  createAuthClient,
  isForbidden,
  isSessionTokens,
  isTwoFactorRequired,
  isUnauthorized,
  memorySession,
  persistSession,
} from "./auth.ts";

describe("memorySession", () => {
  test("subscribe notifies on set and clear", () => {
    const s = memorySession();
    let n = 0;
    const unsub = s.subscribe(() => {
      n += 1;
    });
    s.set({ accessToken: "a", refreshToken: "r", userId: "u1" });
    expect(n).toBe(1);
    s.clear();
    expect(n).toBe(2);
    unsub();
    s.set({ accessToken: "a2", refreshToken: "r2" });
    expect(n).toBe(2);
  });

  test("persistSession round-trips via Storage", () => {
    const store = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return store.size;
      },
      clear() {
        store.clear();
      },
      getItem(k) {
        return store.get(k) ?? null;
      },
      key() {
        return null;
      },
      removeItem(k) {
        store.delete(k);
      },
      setItem(k, v) {
        store.set(k, v);
      },
    };
    const a = persistSession(storage);
    a.set({ accessToken: "tok", refreshToken: "ref", userId: "u" });
    const b = persistSession(storage);
    expect(b.getToken()).toBe("tok");
    expect(b.refreshToken).toBe("ref");
  });
});

describe("denials", () => {
  test("narrowers", () => {
    expect(isUnauthorized({ code: "Unauthorized", data: {} })).toBe(true);
    expect(isForbidden({ code: "Forbidden", data: { reason: "csrf" } })).toBe(true);
    expect(isTwoFactorRequired({ twoFactorRequired: true, challengeId: "c", method: "totp", userId: "u" })).toBe(
      true,
    );
    expect(isSessionTokens({ accessToken: "a", refreshToken: "r" })).toBe(true);
  });
});

describe("createAuthClient", () => {
  test("refuses cookie mode with localStorage persist", () => {
    expect(() =>
      createAuthClient({ auth: {} }, { mode: "cookie", persist: "localStorage", csrfConfigured: true }),
    ).toThrow(/cannot persist/);
  });

  test("warns when cookie mode without csrfConfigured", () => {
    const warnings: string[] = [];
    createAuthClient(
      { auth: {} },
      {
        mode: "cookie",
        env: { warn: (m) => warnings.push(m) },
      },
    );
    expect(warnings.some((w) => w.includes("csrf"))).toBe(true);
  });

  test("signIn.email sets session and hasScope is UI-only from me", async () => {
    const api = {
      auth: {
        signInEmail: async () => ({
          data: {
            accessToken: "a",
            refreshToken: "r",
            accessExpiresAt: Date.now() + 60_000,
            userId: "u1",
          },
          error: null,
        }),
        me: async () => ({
          data: {
            userId: "u1",
            email: "a@b.co",
            name: "A",
            emailVerified: true,
            scopes: ["orders:write"],
            tenantId: null,
            apiKeyId: null,
          },
          error: null,
        }),
        revoke: async () => ({ data: { ok: true }, error: null }),
      },
    };
    const auth = createAuthClient(api, { csrfConfigured: true });
    const result = await auth.signIn.email({ email: "a@b.co", password: "x" });
    expect(result.ok).toBe(true);
    expect(auth.hasScope("orders:write")).toBe(true);
    expect(auth.can("orders:write")).toBe(true);
    expect(auth.hasScope("admin")).toBe(false);
    await auth.signOut();
    expect(auth.session.getToken()).toBeNull();
  });

  test("twoFactorRequired discrimination", async () => {
    const api = {
      auth: {
        signInEmail: async () => ({
          data: {
            twoFactorRequired: true as const,
            challengeId: "ch1",
            method: "totp",
            userId: "u1",
          },
          error: null,
        }),
      },
    };
    const auth = createAuthClient(api);
    const result = await auth.signIn.email({ email: "a@b.co", password: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.twoFactor?.challengeId).toBe("ch1");
  });

  test("setTenant adds header via clientOptions", () => {
    const auth = createAuthClient({ auth: {} });
    auth.setTenant("t_1");
    const headers = auth.clientOptions.headers?.();
    expect(headers?.["x-oke-tenant"]).toBe("t_1");
  });

  test("authorize reports allowed / denied / unauthenticated", async () => {
    const api = {
      auth: {
        signInEmail: async () => ({
          data: {
            accessToken: "a",
            refreshToken: "r",
            userId: "u1",
          },
          error: null,
        }),
        me: async () => ({
          data: {
            userId: "u1",
            email: "a@b.co",
            name: "A",
            scopes: ["notes:write"],
            tenantId: null,
            apiKeyId: null,
          },
          error: null,
        }),
      },
    };
    const auth = createAuthClient(api);
    expect(auth.authorize({ all: ["notes:write"] }).status).toBe("unauthenticated");
    await auth.signIn.email({ email: "a@b.co", password: "x" });
    expect(auth.authorize({ all: ["notes:write"] }).status).toBe("allowed");
    const denied = auth.authorize({ all: ["notes:write", "admin"] });
    expect(denied.status).toBe("denied");
    if (denied.status === "denied") expect(denied.missing).toEqual(["admin"]);
    expect(auth.authorize({ any: ["admin", "notes:write"] }).status).toBe("allowed");
  });
});

describe("tokenFromRequestCookies", () => {
  test("parses access cookie from header / Request", async () => {
    const { tokenFromRequestCookies } = await import("./auth.ts");
    const header = "oke.session_token=abc%20123; other=1";
    expect(tokenFromRequestCookies(header)).toBe("abc 123");
    expect(tokenFromRequestCookies(new Headers({ cookie: header }))).toBe("abc 123");
    expect(
      tokenFromRequestCookies(new Request("http://localhost", { headers: { cookie: header } })),
    ).toBe("abc 123");
    expect(tokenFromRequestCookies("")).toBeNull();
  });
});

describe("createClient session auth", () => {
  test("attaches api.auth and preserves auth unit flows", async () => {
    const { createClient } = await import("./create-with-session.ts");
    const calls: string[] = [];
    const api = createClient("http://example.test", {
      $routes: {
        auth: {
          me: { method: "GET", path: "/auth/me" },
        },
      },
      auth: { mode: "bearer", csrfConfigured: true },
      fetch: async (input) => {
        calls.push(String(input));
        return new Response(
          JSON.stringify({
            data: {
              userId: "u1",
              email: "a@b.co",
              name: "A",
              scopes: ["notes:write"],
              tenantId: null,
              apiKeyId: null,
            },
            error: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    expect(api.auth).toBeDefined();
    expect(typeof api.auth?.authorize).toBe("function");
    // Runtime merge keeps unit Flows (`me`) on the AuthClient proxy.
    expect(api.auth && "me" in api.auth && typeof (api.auth as { me: unknown }).me === "function").toBe(
      true,
    );
    const user = await api.auth!.getSession();
    expect(user?.scopes).toEqual(["notes:write"]);
    expect(calls.some((u) => u.includes("/auth/me"))).toBe(true);
  });
});
