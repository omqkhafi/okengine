/**
 * `oke doctor` — missing secret, port conflict, schema drift.
 */

import { describe, expect, test } from "bun:test";
import { runDoctor } from "./doctor.ts";

describe("oke doctor", () => {
  test("catches a missing secret", async () => {
    const { code, findings } = await runDoctor({
      secrets: ["STRIPE_KEY", "DATABASE_URL"],
      env: (k) => (k === "DATABASE_URL" ? "postgres://x" : undefined),
      ports: [],
      currentSchemaFingerprint: null,
      expectedSchemaFingerprint: undefined,
      write: () => {},
    });
    expect(code).toBe(1);
    expect(findings.some((f) => f.code === "missing_secret")).toBe(true);
    expect(
      findings.find((f) => f.message.includes("STRIPE_KEY")),
    ).toBeDefined();
  });

  test("catches a port conflict", async () => {
    const { code, findings } = await runDoctor({
      secrets: [],
      ports: [6530],
      isPortInUse: async (p) => p === 6530,
      currentSchemaFingerprint: "abc",
      expectedSchemaFingerprint: "abc",
      write: () => {},
    });
    expect(code).toBe(1);
    expect(findings.some((f) => f.code === "port_conflict")).toBe(true);
    expect(findings[0]!.message).toContain("6530");
  });

  test("catches schema drift", async () => {
    const { code, findings } = await runDoctor({
      secrets: [],
      ports: [],
      isPortInUse: async () => false,
      expectedSchemaFingerprint: "aaa",
      currentSchemaFingerprint: "bbb",
      write: () => {},
    });
    expect(code).toBe(1);
    expect(findings.some((f) => f.code === "schema_drift")).toBe(true);
  });

  test("ok when secrets present, ports free, schema matches", async () => {
    const { code, findings } = await runDoctor({
      secrets: ["STRIPE_KEY"],
      env: () => "sk_test",
      ports: [6530],
      isPortInUse: async () => false,
      expectedSchemaFingerprint: "same",
      currentSchemaFingerprint: "same",
      write: () => {},
    });
    expect(code).toBe(0);
    expect(findings).toHaveLength(0);
  });
});
