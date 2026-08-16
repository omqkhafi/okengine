/**
 * Retention helpers — keep window vs partition day keys.
 */

import { describe, expect, test } from "bun:test";
import { partitionDayFromKey, retentionKeepMs, shouldDropPartition } from "./retention.ts";

describe("runs retention helpers", () => {
  test("retentionKeepMs parses durations and forever", () => {
    expect(retentionKeepMs("forever")).toBeNull();
    expect(retentionKeepMs(undefined)).toBeNull();
    expect(retentionKeepMs("7d")).toBe(7 * 86_400_000);
    expect(retentionKeepMs("30d")).toBe(30 * 86_400_000);
    expect(retentionKeepMs("nope")).toBeNull();
  });

  test("shouldDropPartition uses day= in the object key", () => {
    const now = Date.parse("2026-08-16T12:00:00.000Z");
    const keep = 7 * 86_400_000;
    expect(shouldDropPartition("runs/day=2026-08-01/a.parquet", now, keep)).toBe(true);
    expect(shouldDropPartition("runs/day=2026-08-15/a.parquet", now, keep)).toBe(false);
    expect(partitionDayFromKey("runs/day=2026-08-15/x.parquet")).toBe("2026-08-15");
  });
});
