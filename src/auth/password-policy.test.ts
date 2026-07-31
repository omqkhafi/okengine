import { describe, expect, test } from "bun:test";
import {
  assertNotBreached,
  createHibpBreachCheck,
  sha1HexUpper,
  BreachCheckError,
} from "./breach-check.ts";
import {
  assertPasswordPolicy,
  PasswordPolicyError,
} from "./password-policy.ts";
import { createBunCrypto } from "../runtime/primitives.ts";
import { ARGON2ID_MEMORY_COST_FLOOR } from "../runtime/types.ts";
import { createOperator, createOperatorStore } from "./operator.ts";
import {
  createSessionStore,
  issueSession,
  rotateRefresh,
  SessionError,
} from "./sessions.ts";

describe("password policy", () => {
  test("defaults require length 12, letter, number", () => {
    expect(() => assertPasswordPolicy("short1A", {})).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy("longenoughword", {})).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy("Longenough12", {})).not.toThrow();
  });

  test("createOperator rejects weak passwords by default without passwordPolicy", async () => {
    const store = createOperatorStore();
    await expect(
      createOperator(store, {
        email: "a@example.com",
        name: "A",
        password: "123",
      }),
    ).rejects.toThrow(PasswordPolicyError);
  });

  test("createOperator skipPasswordPolicy is the explicit test opt-out", async () => {
    const store = createOperatorStore();
    const op = await createOperator(store, {
      email: "b@example.com",
      name: "B",
      password: "123",
      skipPasswordPolicy: true,
    });
    expect(op.email).toBe("b@example.com");
  });
});

describe("Bun.password costs", () => {
  test("rejects memoryCost below Bun floor", async () => {
    const crypto = createBunCrypto();
    await expect(
      crypto.hashPassword("Longenough12", { algorithm: "argon2id", memoryCost: 1024 }),
    ).rejects.toThrow(/memoryCost/);
  });

  test("hashes at Bun default floor", async () => {
    const crypto = createBunCrypto();
    const hash = await crypto.hashPassword("Longenough12", {
      algorithm: "argon2id",
      memoryCost: ARGON2ID_MEMORY_COST_FLOOR,
      timeCost: 2,
    });
    expect(hash).toContain("m=65536,t=2");
    expect(await crypto.verifyPassword("Longenough12", hash)).toBe(true);
  });
});

describe("HIBP k-anonymity helper", () => {
  test("matches suffix locally without sending full hash", async () => {
    const full = await sha1HexUpper("password");
    const prefix = full.slice(0, 5);
    const suffix = full.slice(5);
    const check = createHibpBreachCheck({
      userAgent: "oke-test",
      fetch: async (input) => {
        const url = String(input);
        expect(url).toContain("/range/");
        if (url.includes(`/range/${prefix}`)) {
          return new Response(`${suffix}:12\nDEADBEEF00:1\n`, { status: 200 });
        }
        return new Response("AAAAA00000:1\n", { status: 200 });
      },
    });
    expect(await check("password")).toBe(true);
    expect(await check("not-in-list-xyz")).toBe(false);
  });

  test("assertNotBreached throws when check returns true", async () => {
    await expect(assertNotBreached("x", async () => true)).rejects.toThrow(BreachCheckError);
  });
});

describe("session idle / absolute / single-session", () => {
  test("idle timeout rejects refresh", async () => {
    let now = 1_000_000;
    const store = createSessionStore();
    const crypto = {
      secret: "test-secret-at-least-32-bytes-long!!",
      now: () => now,
      idleTtlMs: 60_000,
    };
    const issued = await issueSession(store, crypto, {
      id: "u1",
      plane: "user",
      scopes: [],
    });
    now += 120_000;
    await expect(rotateRefresh(store, crypto, issued.refreshToken)).rejects.toThrow(SessionError);
  });

  test("singleSessionPerUser revokes prior family", async () => {
    const store = createSessionStore();
    const crypto = {
      secret: "test-secret-at-least-32-bytes-long!!",
      now: () => 1_000_000,
      singleSessionPerUser: true,
    };
    const first = await issueSession(store, crypto, {
      id: "u1",
      plane: "user",
      scopes: [],
    });
    await issueSession(store, crypto, {
      id: "u1",
      plane: "user",
      scopes: [],
    });
    expect(store.sessions.get(first.session.id)?.revokedAt).not.toBeNull();
  });
});
