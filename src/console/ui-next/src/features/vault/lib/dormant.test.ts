/**
 * Dormant secret detection (console §9.8 · §9.16).
 */

import { describe, expect, test } from "bun:test";
import { DORMANT_MS, dormantSecrets } from "./dormant.ts";
import { VAULT_FIXTURE } from "./fixture.ts";
import type { VaultRecord } from "./types.ts";

describe("dormantSecrets", () => {
  test("flags never-read secrets and ignores config", () => {
    const now = 1_700_000_000_000;
    const neverRead: VaultRecord = {
      ...VAULT_FIXTURE[0]!,
      name: "LEGACY_WEBHOOK_SECRET",
      lastReadAt: null,
      readers: [],
    };
    const dormant = dormantSecrets([...VAULT_FIXTURE, neverRead], now);
    expect(dormant.some((s) => s.name === "LEGACY_WEBHOOK_SECRET")).toBe(true);
    expect(dormant.some((s) => s.kind === "config")).toBe(false);
  });

  test("flags secrets unread for 90+ days", () => {
    const now = 1_700_000_000_000;
    const stale: VaultRecord = {
      ...VAULT_FIXTURE[0]!,
      name: "OLD_KEY",
      lastReadAt: now - DORMANT_MS - 1,
    };
    const dormant = dormantSecrets([stale], now);
    expect(dormant.map((s) => s.name)).toEqual(["OLD_KEY"]);
  });
});
