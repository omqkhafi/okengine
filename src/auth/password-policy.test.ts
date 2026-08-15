import { describe, expect, test } from "bun:test";
import {
  assertNotBreached,
  createHibpBreachCheck,
  sha1HexUpper,
  BreachCheckError,
} from "./breach-check.ts";
import {
  assertPasswordPolicy,
  DEFAULT_PASSWORD_POLICY,
  generatePassword,
  PasswordPolicyError,
  resolvePasswordPolicy,
} from "./password-policy.ts";
import {
  CONSOLE_PASSWORD_POLICY,
  consolePasswordMeetsPolicy,
  evaluateConsolePasswordRules,
  generateConsolePassword,
} from "../console/password-policy.ts";
import { createBunCrypto } from "../runtime/primitives.ts";
import { ARGON2ID_MEMORY_COST_FLOOR } from "../runtime/types.ts";
import { createOperator, createOperatorStore } from "./operator.ts";
import { createSessionStore, issueSession, rotateRefresh, SessionError } from "./sessions.ts";

describe("password policy", () => {
  test("defaults require length 8, upper, lower, number, special", () => {
    expect(() => assertPasswordPolicy("Aa1!", {})).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy("password", {})).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy("Password1", {})).toThrow(PasswordPolicyError);
    expect(() => assertPasswordPolicy("Password1!", {})).not.toThrow();
  });

  test("DEFAULT_PASSWORD_POLICY separates upper, lower, and requireSpecial", () => {
    const resolved = resolvePasswordPolicy(DEFAULT_PASSWORD_POLICY);
    expect(resolved.minLength).toBe(8);
    expect(resolved.requireLetter).toBe(true);
    expect(resolved.requireNumber).toBe(true);
    expect(resolved.requireUppercase).toBe(true);
    expect(resolved.requireLowercase).toBe(true);
    expect(resolved.requireSpecial).toBe(true);

    expect(() => assertPasswordPolicy("password1!", DEFAULT_PASSWORD_POLICY)).toThrow(
      /requireUppercase/,
    );
    expect(() => assertPasswordPolicy("PASSWORD1!", DEFAULT_PASSWORD_POLICY)).toThrow(
      /requireLowercase/,
    );
  });

  test("rejects password missing ONLY a special character (Global + Console)", () => {
    // Global: length 8+, upper, lower, number — no special.
    const globalOnlyMissingSpecial = "Password1";
    expect(globalOnlyMissingSpecial.length).toBeGreaterThanOrEqual(
      DEFAULT_PASSWORD_POLICY.minLength,
    );
    expect(/[A-Z]/.test(globalOnlyMissingSpecial)).toBe(true);
    expect(/[a-z]/.test(globalOnlyMissingSpecial)).toBe(true);
    expect(/\d/.test(globalOnlyMissingSpecial)).toBe(true);
    expect(/[^A-Za-z0-9]/.test(globalOnlyMissingSpecial)).toBe(false);
    expect(() => assertPasswordPolicy(globalOnlyMissingSpecial, DEFAULT_PASSWORD_POLICY)).toThrow(
      PasswordPolicyError,
    );
    try {
      assertPasswordPolicy(globalOnlyMissingSpecial, DEFAULT_PASSWORD_POLICY);
    } catch (err) {
      expect(err).toBeInstanceOf(PasswordPolicyError);
      expect((err as PasswordPolicyError).reasons).toEqual(["requireSpecial"]);
    }

    // Console: length 12+, upper, lower, number — no special.
    const consoleOnlyMissingSpecial = "Password1234";
    expect(consoleOnlyMissingSpecial.length).toBeGreaterThanOrEqual(
      CONSOLE_PASSWORD_POLICY.minLength,
    );
    expect(/[A-Z]/.test(consoleOnlyMissingSpecial)).toBe(true);
    expect(/[a-z]/.test(consoleOnlyMissingSpecial)).toBe(true);
    expect(/\d/.test(consoleOnlyMissingSpecial)).toBe(true);
    expect(/[^A-Za-z0-9]/.test(consoleOnlyMissingSpecial)).toBe(false);
    expect(() => assertPasswordPolicy(consoleOnlyMissingSpecial, CONSOLE_PASSWORD_POLICY)).toThrow(
      PasswordPolicyError,
    );
    try {
      assertPasswordPolicy(consoleOnlyMissingSpecial, CONSOLE_PASSWORD_POLICY);
    } catch (err) {
      expect(err).toBeInstanceOf(PasswordPolicyError);
      expect((err as PasswordPolicyError).reasons).toEqual(["requireSpecial"]);
    }
  });

  test("requireUppercase, requireLowercase, and requireSpecial can be turned off", () => {
    const loose = {
      minLength: 8,
      requireUppercase: false,
      requireLowercase: false,
      requireSpecial: false,
      requireLetter: true,
      requireNumber: true,
    };
    expect(() => assertPasswordPolicy("password1", loose)).not.toThrow();
    expect(() => assertPasswordPolicy("PASSWORD1", loose)).not.toThrow();
  });

  test("ui-next checklist criteria match Console server validation exactly", () => {
    const rules = evaluateConsolePasswordRules("");
    expect(rules.map((r) => r.id)).toEqual([
      "length",
      "uppercase",
      "lowercase",
      "number",
      "special",
    ]);
    expect(rules.find((r) => r.id === "length")?.label).toBe(
      `At least ${CONSOLE_PASSWORD_POLICY.minLength} characters`,
    );
    expect(CONSOLE_PASSWORD_POLICY.minLength).toBe(12);
    expect(CONSOLE_PASSWORD_POLICY.requireSpecial).toBe(true);

    const samples = [
      "",
      "short",
      "password1234",
      "Password1234",
      "PASSWORD1234!",
      "Password!!!!!",
      "Password12!!",
      "CorrectHorse1!",
    ];
    for (const password of samples) {
      const allMet = evaluateConsolePasswordRules(password).every((rule) => rule.met);
      const serverOk = consolePasswordMeetsPolicy(password);
      expect(allMet).toBe(serverOk);
      if (serverOk) {
        expect(() => assertPasswordPolicy(password, CONSOLE_PASSWORD_POLICY)).not.toThrow();
      } else {
        expect(() => assertPasswordPolicy(password, CONSOLE_PASSWORD_POLICY)).toThrow(
          PasswordPolicyError,
        );
      }
    }
  });

  test("generatePassword always satisfies the requested policy", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 64; i++) {
      const password = generatePassword(CONSOLE_PASSWORD_POLICY);
      expect(password.length).toBeGreaterThanOrEqual(CONSOLE_PASSWORD_POLICY.minLength);
      expect(() => assertPasswordPolicy(password, CONSOLE_PASSWORD_POLICY)).not.toThrow();
      expect(consolePasswordMeetsPolicy(password)).toBe(true);
      expect(evaluateConsolePasswordRules(password).every((rule) => rule.met)).toBe(true);
      seen.add(password);
    }
    expect(seen.size).toBe(64);
    expect(() => assertPasswordPolicy(generatePassword(), DEFAULT_PASSWORD_POLICY)).not.toThrow();
    expect(generateConsolePassword()).toHaveLength(16);
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
      fetch: (async (input) => {
        const url = String(input);
        expect(url).toContain("/range/");
        if (url.includes(`/range/${prefix}`)) {
          return new Response(`${suffix}:12\nDEADBEEF00:1\n`, { status: 200 });
        }
        return new Response("AAAAA00000:1\n", { status: 200 });
      }) as typeof fetch,
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
