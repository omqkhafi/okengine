import { describe, expect, test } from "bun:test";
import { formatRewrapProgress } from "./progress.ts";

describe("formatRewrapProgress", () => {
  test("phase 1 while remaining or rewrap target is set", () => {
    const line = formatRewrapProgress({
      kekVersion: 1,
      remaining: 4,
      rewrapTargetKekVersion: 2,
    });
    expect(line?.phase).toBe(1);
    expect(line?.headline).toContain("v1");
    expect(line?.headline).toContain("v2");
    expect(line?.detail).toContain("4 DEKs");
  });

  test("phase 2 only when remaining is 0 and no target", () => {
    const line = formatRewrapProgress({
      kekVersion: 2,
      remaining: 0,
      rewrapTargetKekVersion: null,
    });
    expect(line?.phase).toBe(2);
    expect(line?.detail).toContain("no longer opens");
  });

  test("idle vault has no progress line", () => {
    expect(
      formatRewrapProgress({
        kekVersion: 1,
        remaining: null,
        rewrapTargetKekVersion: null,
      }),
    ).toBeNull();
  });
});
