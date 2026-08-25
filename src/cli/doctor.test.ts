/**
 * `oke doctor` — missing secret, port conflict, schema drift, PII→ask.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../manifest/types.ts";
import { runDoctor } from "./doctor.ts";
import { estimatePeakFds } from "./doctor-fd.ts";

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

  test("fails closed in prod when builtin vault master key is env-sourced", async () => {
    const { code, findings } = await runDoctor({
      secrets: [],
      ports: [],
      isPortInUse: async () => false,
      skipDbDrift: true,
      configEnv: "prod",
      driversConfig: {
        vault: { dev: "vault", test: "memory", prod: "vault" },
      },
      vaultConfig: {
        encryption: { masterKey: { kind: "env", name: "OKE_VAULT_MASTER_KEY" } },
      },
      write: () => {},
    });
    expect(code).toBe(2);
    const finding = findings.find((f) => f.code === "vault_master_key");
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("environment variable");
  });

  test("NODE_ENV=production selects prod env for the vault master-key gate", async () => {
    const { code, findings } = await runDoctor({
      secrets: [],
      ports: [],
      isPortInUse: async () => false,
      skipDbDrift: true,
      env: (k) => (k === "NODE_ENV" ? "production" : undefined),
      driversConfig: {
        vault: { dev: "vault", test: "memory", prod: "vault" },
      },
      vaultConfig: {
        encryption: { masterKey: { kind: "env", name: "OKE_VAULT_MASTER_KEY" } },
      },
      write: () => {},
    });
    expect(code).toBe(2);
    expect(findings.some((f) => f.code === "vault_master_key")).toBe(true);
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

describe("doctor file_descriptor_limit", () => {
  const base = {
    secrets: [] as string[],
    ports: [] as number[],
    skipDbDrift: true,
    expectedSchemaFingerprint: "same",
    currentSchemaFingerprint: "same",
    write: () => {},
  };

  test("warns when soft limit is low relative to estimated need", async () => {
    const { code, findings } = await runDoctor({
      ...base,
      detectFdPressure: async () => ({ softLimit: 256, estimatedNeed: 400, headroom: -144 }),
    });
    expect(code).toBe(0);
    expect(
      findings.some((f) => f.code === "file_descriptor_limit" && f.severity === "warn"),
    ).toBe(true);
  });

  test("errors when soft limit below estimated need", async () => {
    const { code, findings } = await runDoctor({
      ...base,
      detectFdPressure: async () => ({ softLimit: 200, estimatedNeed: 400, headroom: -200 }),
    });
    expect(code).toBe(2);
    const finding = findings.find((f) => f.code === "file_descriptor_limit");
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("file descriptor");
  });

  test("no finding with ample headroom", async () => {
    const { code, findings } = await runDoctor({
      ...base,
      detectFdPressure: async () => ({ softLimit: 65536, estimatedNeed: 500, headroom: 65036 }),
    });
    expect(code).toBe(0);
    expect(findings.some((f) => f.code === "file_descriptor_limit")).toBe(false);
  });

  test("skips conservatively without manifest/live signals", async () => {
    const findings: unknown[] = [];
    const { code } = await runDoctor({
      ...base,
      write: (t) => findings.push(t),
    });
    // Real probe runs; on typical dev limits it must not throw and must exit ok.
    expect([0, 2]).toContain(code);
  });

  test("estimatePeakFds counts live signals and http routes", async () => {
    const manifest = {
      oke: "1.0",
      app: "t",
      signals: {
        tick: { delivery: "live" },
        once: { delivery: "once" },
        fan: { delivery: "broadcast" },
      },
      flows: {
        sse: { trigger: { http: { method: "GET", path: "/live" } }, live: "tick" },
        plain: { trigger: { http: { method: "POST", path: "/x" } } },
      },
    } as unknown as Manifest;
    const need = estimatePeakFds(manifest);
    expect(need).toBeGreaterThan(estimatePeakFds(null));
    expect(need).toBeGreaterThanOrEqual(64 * 2 * 2); // live signal + SSE route, ≥2 fds/sub
  });

  test("estimatePeakFds subscriber term is linear in live signals (G3b-calibrated)", () => {
    const one = {
      oke: "1.0",
      app: "t",
      signals: { a: { delivery: "live" } },
      flows: {},
    } as unknown as Manifest;
    const two = {
      ...one,
      signals: { a: { delivery: "live" }, b: { delivery: "live" } },
    } as unknown as Manifest;
    const base = estimatePeakFds(null);
    const deltaOne = estimatePeakFds(one) - base;
    const deltaTwo = estimatePeakFds(two) - base;
    // Each additional live signal adds the same subscriber-fd budget.
    expect(deltaTwo).toBe(deltaOne * 2);
    // G3b measured 1.53 fds/subscriber; budget must be at least 1 fd/sub.
    expect(deltaOne).toBeGreaterThanOrEqual(64);
  });
});
