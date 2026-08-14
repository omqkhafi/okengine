import { describe, expect, test } from "bun:test";
import { DORMANT_MS } from "./dormant.ts";
import { VAULT_FIXTURE } from "./fixture.ts";
import {
  contractPosture,
  formatRelativeTime,
  isContractSet,
  parseRotateHintMs,
  summarizePosture,
} from "./posture.ts";
import type { VaultRecord } from "./types.ts";

const NOW = 1_700_000_000_000;

describe("parseRotateHintMs", () => {
  test("parses clock-style durations", () => {
    expect(parseRotateHintMs("90d")).toBe(90 * 86_400_000);
    expect(parseRotateHintMs("12h")).toBe(12 * 3_600_000);
    expect(parseRotateHintMs("bad")).toBe(0);
    expect(parseRotateHintMs(undefined)).toBe(0);
  });
});

describe("contractPosture", () => {
  test("fixture secret is set, blast, shared, not dormant at lastReadAt", () => {
    const p = contractPosture(VAULT_FIXTURE[0]!, NOW);
    expect(p.set).toBe(true);
    expect(p.unset).toBe(false);
    expect(p.blast).toBe(true);
    expect(p.shared).toBe(true);
    expect(p.dormant).toBe(false);
    expect(p.healthy).toBe(false);
    expect(p.primary).toBe("blast");
  });

  test("fixture config is set and not a secret risk", () => {
    const p = contractPosture(VAULT_FIXTURE[1]!, NOW);
    expect(p.set).toBe(true);
    expect(p.dormant).toBe(false);
    expect(p.primary).toBe("config");
  });

  test("unset secret is primary unset", () => {
    const row: VaultRecord = {
      ...VAULT_FIXTURE[0]!,
      fingerprint: null,
      fingerprints: {},
      blastRadius: { count: 0, longestWakeAt: null, longestOutstandingMs: null, runIds: [] },
      sharedFingerprintEnvs: [],
    };
    const p = contractPosture(row, NOW);
    expect(p.unset).toBe(true);
    expect(p.primary).toBe("unset");
  });

  test("overdue when set and last read older than rotate hint", () => {
    const row: VaultRecord = {
      ...VAULT_FIXTURE[0]!,
      rotate: "90d",
      lastReadAt: NOW - 91 * 86_400_000,
      blastRadius: { count: 0, longestWakeAt: null, longestOutstandingMs: null, runIds: [] },
      sharedFingerprintEnvs: [],
    };
    const p = contractPosture(row, NOW);
    expect(p.overdue).toBe(true);
    expect(p.dormant).toBe(true);
    expect(p.primary).toBe("overdue");
  });

  test("healthy secret has no risks", () => {
    const row: VaultRecord = {
      ...VAULT_FIXTURE[0]!,
      lastReadAt: NOW - 60_000,
      blastRadius: { count: 0, longestWakeAt: null, longestOutstandingMs: null, runIds: [] },
      sharedFingerprintEnvs: [],
    };
    const p = contractPosture(row, NOW);
    expect(p.healthy).toBe(true);
    expect(p.primary).toBe("healthy");
  });

  test("never-read secret is dormant", () => {
    const row: VaultRecord = { ...VAULT_FIXTURE[0]!, lastReadAt: null };
    expect(contractPosture(row, NOW).dormant).toBe(true);
    expect(contractPosture(row, NOW).unread).toBe(true);
  });
});

describe("summarizePosture", () => {
  test("counts fixture rows", () => {
    const sum = summarizePosture(VAULT_FIXTURE, NOW);
    expect(sum.total).toBe(2);
    expect(sum.secrets).toBe(1);
    expect(sum.config).toBe(1);
    expect(sum.blast).toBe(1);
    expect(sum.shared).toBe(1);
    expect(sum.unset).toBe(0);
  });
});

describe("isContractSet", () => {
  test("sensitive uses fingerprint; config uses cleartext", () => {
    expect(isContractSet(VAULT_FIXTURE[0]!)).toBe(true);
    expect(isContractSet(VAULT_FIXTURE[1]!)).toBe(true);
    expect(isContractSet({ ...VAULT_FIXTURE[0]!, fingerprint: null })).toBe(false);
  });
});

describe("formatRelativeTime", () => {
  test("units", () => {
    expect(formatRelativeTime(NOW, NOW)).toBe("just now");
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(formatRelativeTime(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(formatRelativeTime(NOW - 2 * 86_400_000, NOW)).toBe("2d ago");
    expect(formatRelativeTime(NOW - DORMANT_MS, NOW)).toBe("3mo ago");
  });
});
