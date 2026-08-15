/**
 * Write-review gate — dialog before mutation; Cancel never commits.
 */

import { describe, expect, test } from "bun:test";
import { fingerprintSecretSync } from "../../../../../../elements/vault/fingerprint.ts";
import {
  cancelVaultWrite,
  confirmVaultWrite,
  fingerprintVaultValue,
  openVaultWriteReview,
} from "./write-review.ts";

const SECRET = "ghp_do_not_commit_this_value";

describe("vault write review", () => {
  test("fingerprint matches the Vault runtime", async () => {
    expect(await fingerprintVaultValue(SECRET)).toBe(fingerprintSecretSync(SECRET));
  });

  test("opening a review does not write", async () => {
    const writes: string[] = [];
    const review = await openVaultWriteReview({
      action: "rotate",
      name: "GITHUB_TOKEN",
      value: SECRET,
      sensitive: true,
      reason: "Scheduled rotation",
    });
    expect("error" in review).toBe(false);
    if ("error" in review) return;
    expect(review.name).toBe("GITHUB_TOKEN");
    expect(review.fingerprint).toBe(fingerprintSecretSync(SECRET));
    expect(review.preview).toBeNull();
    expect(review.reason).toBe("Scheduled rotation");
    expect(JSON.stringify(reviewView(review))).not.toContain(SECRET);
    expect(writes).toEqual([]);
  });

  test("Cancel aborts — confirm(null) never commits", async () => {
    const writes: string[] = [];
    const opened = await openVaultWriteReview({
      action: "set",
      name: "STRIPE_KEY",
      value: SECRET,
      sensitive: true,
      reason: "Correct a bad value",
    });
    expect("error" in opened).toBe(false);
    const cancelled = cancelVaultWrite();
    const result = confirmVaultWrite(cancelled, (review) => {
      writes.push(review.commit.value);
      return review.commit.name;
    });
    expect(result).toBeNull();
    expect(writes).toEqual([]);
  });

  test("Confirm is the only commit — once, after review", async () => {
    const writes: string[] = [];
    const review = await openVaultWriteReview({
      action: "rotate",
      name: "GITHUB_TOKEN",
      value: SECRET,
      sensitive: true,
      reason: "Key compromise",
    });
    expect("error" in review).toBe(false);
    if ("error" in review) return;
    expect(writes).toEqual([]);
    const result = confirmVaultWrite(review, (next) => {
      writes.push(next.commit.value);
      return next.commit.name;
    });
    expect(result).toBe("GITHUB_TOKEN");
    expect(writes).toEqual([SECRET]);
  });

  test("create uses the same review gate", async () => {
    const writes: string[] = [];
    const review = await openVaultWriteReview({
      action: "create",
      name: "ISSUE_PEPPER",
      value: SECRET,
      sensitive: true,
      kind: "secret",
      rotate: "never",
    });
    expect("error" in review).toBe(false);
    if ("error" in review) return;
    expect(review.action).toBe("create");
    expect(review.kind).toBe("secret");
    expect(review.reason).toBeNull();
    expect(writes).toEqual([]);
    confirmVaultWrite(cancelVaultWrite(), (next) => writes.push(next.commit.value));
    expect(writes).toEqual([]);
    confirmVaultWrite(review, (next) => writes.push(next.commit.value));
    expect(writes).toEqual([SECRET]);
  });

  test("config review may show the value; secrets never preview", async () => {
    const config = await openVaultWriteReview({
      action: "set",
      name: "PUBLIC_API_URL",
      value: "https://api.example.com",
      sensitive: false,
      kind: "config",
      reason: "Provider changed it",
    });
    expect("error" in config).toBe(false);
    if ("error" in config) return;
    expect(config.preview).toBe("https://api.example.com");

    const secret = await openVaultWriteReview({
      action: "create",
      name: "STRIPE_KEY",
      value: SECRET,
      sensitive: true,
      kind: "secret",
    });
    expect("error" in secret).toBe(false);
    if ("error" in secret) return;
    expect(secret.preview).toBeNull();
  });
});

function reviewView(review: {
  readonly name: string;
  readonly fingerprint: string;
  readonly preview: string | null;
  readonly reason: string | null;
}): object {
  return {
    name: review.name,
    fingerprint: review.fingerprint,
    preview: review.preview,
    reason: review.reason,
  };
}
