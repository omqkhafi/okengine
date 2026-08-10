/**
 * Claim-code acceptance — TTL, constant-time compare, rate limit, print-once.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAIM_RATE_LIMIT,
  claimCodeArtifactPath,
  clearClaimCodeArtifact,
  constantTimeEqual,
  mintClaimCode,
  printClaimCodeOnce,
  readClaimCodeArtifact,
  verifyClaimCode,
  writeClaimCodeArtifact,
} from "./claim.ts";

describe("claim code", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

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
    const chunks: string[] = [];
    printClaimCodeOnce(state, (l) => chunks.push(l));
    printClaimCodeOnce(state, (l) => chunks.push(l));
    const joined = chunks.join("");
    expect(joined).toContain(state.code);
    expect(joined).toContain("Claim code");
    expect(chunks.length).toBe(1);
  });

  test("constantTimeEqual is length-safe", () => {
    expect(constantTimeEqual("abcd", "abcd")).toBe(true);
    expect(constantTimeEqual("abcd", "abce")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });

  test("mirrors claim to .oke/claim-code and reads it back", () => {
    const cwd = mkdtempSync(join(tmpdir(), "oke-claim-"));
    dirs.push(cwd);
    let t = 1_000_000;
    const state = mintClaimCode(() => t);
    const path = writeClaimCodeArtifact(cwd, state);
    expect(path).toBe(claimCodeArtifactPath(cwd));
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      code: string;
      expiresAt: number;
    };
    expect(raw.code).toBe(state.code);
    expect(raw.expiresAt).toBe(state.expiresAt);
    const read = readClaimCodeArtifact(cwd, () => t);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.artifact.code).toBe(state.code);
  });

  test("readClaimCodeArtifact reports expired", () => {
    const cwd = mkdtempSync(join(tmpdir(), "oke-claim-"));
    dirs.push(cwd);
    let t = 1_000_000;
    const state = mintClaimCode(() => t);
    writeClaimCodeArtifact(cwd, state);
    t += 31 * 60 * 1000;
    expect(readClaimCodeArtifact(cwd, () => t)).toEqual({
      ok: false,
      reason: "expired",
      path: claimCodeArtifactPath(cwd),
    });
  });

  test("clearClaimCodeArtifact removes the mirror", () => {
    const cwd = mkdtempSync(join(tmpdir(), "oke-claim-"));
    dirs.push(cwd);
    const state = mintClaimCode(() => 1);
    writeClaimCodeArtifact(cwd, state);
    clearClaimCodeArtifact(cwd);
    expect(readClaimCodeArtifact(cwd, () => 1).ok).toBe(false);
  });
});
