/**
 * Auth-surface rate limiting + constant-time claim compare (console §10.4).
 */

import { describe, expect, test } from "bun:test";
import { authenticateOperator, createOperator, createOperatorStore } from "../../auth/operator.ts";
import {
  AUTH_RATE_LIMIT,
  createLoginAttemptBag,
  touchLoginRateLimit,
  touchRateLimit,
} from "./auth-rate.ts";
import { constantTimeEqual, mintClaimCode, verifyClaimCode } from "./claim.ts";

describe("auth-rate strategy", () => {
  test("5 attempts / 60s sliding window", () => {
    const attempts: number[] = [];
    let t = 1_000_000;
    for (let i = 0; i < AUTH_RATE_LIMIT; i++) {
      expect(touchRateLimit(attempts, t)).toBe("ok");
      t += 1;
    }
    expect(touchRateLimit(attempts, t)).toBe("rate_limited");
  });

  test("login bag is keyed per email", () => {
    const bag = createLoginAttemptBag();
    let t = 1;
    for (let i = 0; i < AUTH_RATE_LIMIT; i++) {
      expect(touchLoginRateLimit(bag, "Ops@Example.com", t++)).toBe("ok");
    }
    expect(touchLoginRateLimit(bag, "ops@example.com", t)).toBe(
      "rate_limited",
    );
    expect(touchLoginRateLimit(bag, "other@example.com", t)).toBe("ok");
  });

  test("setup-claim uses the same limit constants + constant-time compare", () => {
    let t = 1_000_000;
    const state = mintClaimCode(() => t);
    for (let i = 0; i < AUTH_RATE_LIMIT; i++) {
      verifyClaimCode(state, "wrong", () => t);
      t += 1;
    }
    expect(verifyClaimCode(state, state.code, () => t)).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    expect(constantTimeEqual("abcd", "abcd")).toBe(true);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });

  test("authenticateOperator always verifies (dummy hash when missing)", async () => {
    const store = createOperatorStore();
    await createOperator(store, {
      email: "ops@example.com",
      name: "Ops",
      password: "password123",
    });

    const tMissing = performance.now();
    expect(
      await authenticateOperator(store, "missing@example.com", "password123"),
    ).toBeNull();
    const missingMs = performance.now() - tMissing;

    const tBad = performance.now();
    expect(
      await authenticateOperator(store, "ops@example.com", "wrong-password"),
    ).toBeNull();
    const badMs = performance.now() - tBad;

    expect(
      await authenticateOperator(store, "ops@example.com", "password123"),
    ).not.toBeNull();

    // Both paths pay an argon2 verify — neither should be near-instant.
    expect(missingMs).toBeGreaterThan(5);
    expect(badMs).toBeGreaterThan(5);
  });
});
