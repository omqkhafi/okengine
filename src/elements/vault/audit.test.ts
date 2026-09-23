/**
 * Audit sinks — secret-free stdout/webhook payloads, and chain commands
 * that exist only for the `db` sink.
 */

import { describe, expect, test } from "bun:test";
import { createAuditSink, type AuditEntry } from "./audit.ts";
import { buildVaultBootChain } from "./boot-chain.ts";
import { createBuiltinVaultAdapter, sqlConnectionAsExec } from "./builtin-adapter.ts";
import { isVaultError } from "./errors.ts";
import { createMemoryVaultSql } from "./test-helpers.ts";

const ENTRY: AuditEntry = {
  action: "set",
  path: "prod/api",
  actorType: "flow",
  actorId: "orders.place",
  success: true,
  requestId: "req-1",
  at: new Date("2026-01-02T03:04:05.000Z"),
};

const SECRET = "sk_live_do_not_log_me";

describe("webhook audit sink", () => {
  test("missing or non-http webhookUrl fails at construction", () => {
    expect(() => createAuditSink("webhook")).toThrow(/webhookUrl/);
    expect(
      isVaultError(
        catchError(() => createAuditSink("webhook")),
        "MISSING_PEER",
      ),
    ).toBe(true);
    expect(
      isVaultError(
        catchError(() => createAuditSink("webhook", { webhookUrl: "/relative" })),
        "MISSING_PEER",
      ),
    ).toBe(true);
    expect(
      isVaultError(
        catchError(() => createAuditSink("webhook", { webhookUrl: "ftp://audit.example/hook" })),
        "MISSING_PEER",
      ),
    ).toBe(true);
  });

  test("POSTs the stdout-shaped JSON, refuses redirects, and omits secret values", async () => {
    const bodies: string[] = [];
    const inits: RequestInit[] = [];
    const sink = createAuditSink("webhook", {
      webhookUrl: "https://audit.example/hook",
      fetch: async (_url, init) => {
        inits.push(init ?? {});
        bodies.push(String(init?.body ?? ""));
        return new Response(null, { status: 204 });
      },
    });

    await sink.append(ENTRY);

    expect(inits[0]?.method).toBe("POST");
    expect(inits[0]?.redirect).toBe("error");
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
    const parsed = JSON.parse(bodies[0] ?? "{}") as Record<string, unknown>;
    expect(parsed).toEqual({
      sink: "oke.vault.audit",
      action: "set",
      path: "prod/api",
      actorType: "flow",
      actorId: "orders.place",
      success: true,
      errorCode: null,
      errorMessage: null,
      requestId: "req-1",
      createdAt: "2026-01-02T03:04:05.000Z",
    });
    expect(bodies[0]).not.toContain(SECRET);
    expect(parsed).not.toHaveProperty("value");
  });

  test("a non-2xx response rejects without echoing the body", async () => {
    const sink = createAuditSink("webhook", {
      webhookUrl: "https://audit.example/hook",
      fetch: async () => new Response(SECRET, { status: 502 }),
    });
    const failure = await sink.append(ENTRY).catch((err: unknown) => err);
    expect(isVaultError(failure, "BACKEND_ERROR")).toBe(true);
    expect((failure as Error).message).not.toContain(SECRET);
    expect((failure as Error).message).toContain("502");
  });
});

describe("vault boot chain", () => {
  test("forwards vault.audit only onto the builtin driver layer", () => {
    const audit = { sink: "webhook" as const, webhookUrl: "https://audit.example/hook" };
    const chain = buildVaultBootChain({ driverId: "vault", audit });
    expect(chain[0]?.driver.id).toBe("vault");
    expect(chain[0]?.options?.audit).toEqual(audit);
    expect(chain.slice(1).every((layer) => layer.options?.audit === undefined)).toBe(true);
  });
});

describe("non-db audit commands", () => {
  test("verify refuses a webhook sink before touching the chain", async () => {
    const sql = createMemoryVaultSql();
    try {
      const adapter = createBuiltinVaultAdapter({
        db: sqlConnectionAsExec(sql),
        audit: { sink: "webhook", webhookUrl: "https://audit.example/hook" },
        fetch: async () => new Response(null, { status: 500 }),
      });
      const failure = await adapter.verifyAudit().catch((err: unknown) => err);
      expect(isVaultError(failure, "UNSUPPORTED")).toBe(true);
      expect((failure as Error).message).toContain('audit.sink "db"');

      const init = await adapter.initialize();
      expect(init.masterKey.length).toBeGreaterThan(0);
    } finally {
      await sql.close();
    }
  });
});

/**
 * Capture a thrown construction error.
 *
 * @param fn - Throwing call
 */
function catchError(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err;
  }
}
