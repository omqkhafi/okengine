/**
 * `oke doctor` — missing secret, port conflict, schema drift, PII→ask.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../manifest/types.ts";
import { runDoctor } from "./doctor.ts";

describe("oke doctor", () => {
  test("catches a missing secret", async () => {
    const { code, findings } = await runDoctor({
      secrets: ["STRIPE_KEY", "DATABASE_URL"],
      env: (k) => (k === "DATABASE_URL" ? "postgres://x" : undefined),
      ports: [],
      currentSchemaFingerprint: null,
      expectedSchemaFingerprint: undefined,
      skipDbDrift: true,
      write: () => {},
    });
    expect(code).toBe(2);
    expect(findings.some((f) => f.code === "missing_secret")).toBe(true);
    expect(findings.find((f) => f.message.includes("STRIPE_KEY"))).toBeDefined();
  });

  test("catches a port conflict", async () => {
    const { code, findings } = await runDoctor({
      secrets: [],
      ports: [6530],
      isPortInUse: async (p) => p === 6530,
      currentSchemaFingerprint: "abc",
      expectedSchemaFingerprint: "abc",
      skipDbDrift: true,
      write: () => {},
    });
    expect(code).toBe(2);
    expect(findings.some((f) => f.code === "port_conflict")).toBe(true);
    expect(findings[0]!.message).toContain("6530");
  });

  test("catches core stub schema drift", async () => {
    const { code, findings } = await runDoctor({
      secrets: [],
      ports: [],
      isPortInUse: async () => false,
      expectedSchemaFingerprint: "aaa",
      currentSchemaFingerprint: "bbb",
      skipDbDrift: true,
      write: () => {},
    });
    expect(code).toBe(2);
    expect(findings.some((f) => f.code === "schema_drift")).toBe(true);
    expect(findings.find((f) => f.code === "schema_drift")?.message).toContain(
      "oke schema generate",
    );
  });

  test("catches domain db_drift from drizzle-kit probe", async () => {
    const { code, findings } = await runDoctor({
      secrets: [],
      ports: [],
      isPortInUse: async () => false,
      currentSchemaFingerprint: null,
      skipDbDrift: false,
      detectDbDrift: async () => ({ drifted: true, detail: "pending migrations" }),
      write: () => {},
    });
    expect(code).toBe(2);
    expect(findings.some((f) => f.code === "db_drift")).toBe(true);
    expect(findings.find((f) => f.code === "db_drift")?.message).toContain("pending");
  });

  test("ok when secrets present, ports free, schema matches", async () => {
    const { code, findings } = await runDoctor({
      secrets: ["STRIPE_KEY"],
      env: () => "sk_test",
      ports: [6530],
      isPortInUse: async () => false,
      expectedSchemaFingerprint: "same",
      currentSchemaFingerprint: "same",
      skipDbDrift: true,
      write: () => {},
    });
    expect(code).toBe(0);
    expect(findings).toHaveLength(0);
  });

  test("fails with flow name when PII reaches unguarded ask", async () => {
    const manifest: Manifest = {
      oke: "1.0",
      app: "test",
      flows: {
        "support.createTicket": {
          pii: "masked",
          in: {
            type: "object",
            properties: {
              subject: { type: "string" },
              email: { type: "string" },
              body: { type: "string" },
            },
          },
          effects: { asks: ["ticket-triage@3"] },
        },
      },
      stores: {
        db: {
          facet: "sql",
          classifications: { email: { pii: true } },
        },
      },
      ai: {
        models: { smart: { provider: "anthropic", tier: "opus" } },
        prompts: { "ticket-triage": { version: 3, model: "smart" } },
      },
    };

    const { code, findings } = await runDoctor({
      manifest,
      secrets: [],
      ports: [],
      currentSchemaFingerprint: null,
      skipDbDrift: true,
      write: () => {},
    });

    expect(code).toBe(2);
    const hit = findings.find((f) => f.code === "pii_ask");
    expect(hit).toBeDefined();
    expect(hit!.message).toContain("support.createTicket");
    expect(hit!.message).toContain("allowPii");
  });

  test("passes PII→ask when allowPii is declared", async () => {
    const manifest: Manifest = {
      oke: "1.0",
      app: "test",
      flows: {
        "support.createTicket": {
          allowPii: true,
          pii: "allow",
          in: {
            type: "object",
            properties: { email: { type: "string" } },
          },
          effects: { asks: ["ticket-triage"] },
        },
      },
      stores: {
        db: {
          facet: "sql",
          classifications: { email: { pii: true } },
        },
      },
      ai: {
        models: { smart: { provider: "anthropic" } },
        prompts: { "ticket-triage": { model: "smart" } },
      },
    };

    const { code, findings } = await runDoctor({
      manifest,
      secrets: [],
      ports: [],
      expectedSchemaFingerprint: "same",
      currentSchemaFingerprint: "same",
      skipDbDrift: true,
      write: () => {},
    });
    expect(code).toBe(0);
    expect(findings.some((f) => f.code === "pii_ask")).toBe(false);
  });
});
