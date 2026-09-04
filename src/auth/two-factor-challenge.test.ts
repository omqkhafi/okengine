/**
 * Pending 2FA challenge + step-up grant store.
 */

import { describe, expect, test } from "bun:test";
import {
  consumeChallenge,
  consumeStepUp,
  createPendingTwoFactorStore,
  createStepUpStore,
  findActiveForUser,
  getChallenge,
  grantStepUp,
  hasActiveChallenge,
  issueChallenge,
  twoFactorEmailOtpIdentifier,
} from "./two-factor-challenge.ts";

describe("pending two-factor challenge store", () => {
  test("issue locks method and replaces prior active challenge", () => {
    const store = createPendingTwoFactorStore();
    const first = issueChallenge(store, {
      userId: "u1",
      method: "email_otp",
      now: 1_000,
      ttlMs: 60_000,
    });
    expect(first.method).toBe("email_otp");
    expect(hasActiveChallenge(store, "u1", 1_000)).toBe(true);

    const second = issueChallenge(store, {
      userId: "u1",
      method: "totp",
      now: 2_000,
      ttlMs: 60_000,
    });
    expect(second.id).not.toBe(first.id);
    expect(getChallenge(store, first.id, 2_000)).toBeUndefined();
    expect(findActiveForUser(store, "u1", 2_000)?.method).toBe("totp");
  });

  test("consume clears active pointer", () => {
    const store = createPendingTwoFactorStore();
    const row = issueChallenge(store, { userId: "u1", method: "totp", now: 1_000 });
    consumeChallenge(store, row, 1_500);
    expect(hasActiveChallenge(store, "u1", 1_500)).toBe(false);
    expect(getChallenge(store, row.id, 1_500)).toBeUndefined();
  });

  test("step-up grant is single-use and purpose-scoped", () => {
    const stepUp = createStepUpStore();
    grantStepUp(stepUp, "u1", "change", 1_000, 60_000);
    expect(consumeStepUp(stepUp, "u1", "enroll", 1_100)).toBe(false);
    expect(consumeStepUp(stepUp, "u1", ["change", "enroll"], 1_100)).toBe(true);
    expect(consumeStepUp(stepUp, "u1", "change", 1_200)).toBe(false);
  });

  test("twoFactorEmailOtpIdentifier namespaces by user", () => {
    expect(twoFactorEmailOtpIdentifier("abc")).toBe("2fa:abc");
  });
});
