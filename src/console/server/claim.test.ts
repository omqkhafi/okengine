/**
 * Claim-code acceptance — TTL, constant-time compare, rate limit, print-once.
 */

import { describe, expect, test } from "bun:test";
import {
  CLAIM_RATE_LIMIT,
  constantTimeEqual,
  mintClaimCode,
  printClaimCodeOnce,
  verifyClaimCode,
} from "./claim.ts";

describe("claim code", () => {
  test("mints a hex code and verifies within TTL", () => {
    let t = 1_000_000;
    const state = mintClaimCode(() => t);
    expect(state.code.length).toBe(32);
    expect(verifyClaimCode(state, state.code, () => t)).toEqual({ ok: true });
  });

  test("rejects after expiry", () => {
    let t = 1_000_000;
    const state = mintClaimCode(() => t);
    t += 31 * 60 * 1000;
    expect(verifyClaimCode(state, state.code, () => t)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  test("rejects mismatch", () => {
    const state = mintClaimCode(() => 1);
    expect(verifyClaimCode(state, "nope", () => 1)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  test("rate-limits repeated attempts", () => {
    let t = 1_000_000;
    const state = mintClaimCode(() => t);
    for (let i = 0; i < CLAIM_RATE_LIMIT; i++) {
      verifyClaimCode(state, "wrong", () => t);
      t += 1;
    }
    expect(verifyClaimCode(state, state.code, () => t)).toEqual({
      ok: false,
      reason: "rate_limited",
    });
  });

  test("prints to boot log exactly once", () => {
    const state = mintClaimCode(() => 1);
    const lines: string[] = [];
    printClaimCodeOnce(state, (l) => lines.push(l));
    printClaimCodeOnce(state, (l) => lines.push(l));
    expect(lines.filter((l) => l.includes(state.code)).length).toBe(1);
  });

  test("constantTimeEqual is length-safe", () => {
    expect(constantTimeEqual("abcd", "abcd")).toBe(true);
    expect(constantTimeEqual("abcd", "abce")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});
