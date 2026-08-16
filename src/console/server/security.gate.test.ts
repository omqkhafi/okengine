/**
 * Console whole-surface security gates (console §10).
 *
 * Walks the live `console.*` flow registry rather than hand-picked samples so
 * an 18th panel's flows are covered automatically.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueSession } from "../../auth/index.ts";
import { PII_MASK } from "../../elements/store/classify.ts";
import type { Binding } from "../../kernel/index.ts";
import type { Manifest } from "../../manifest/types.ts";
import type { WideEvent } from "../../runs/types.ts";
import type { ConsoleAppHandle } from "./app.ts";
import { AUTH_RATE_LIMIT } from "./auth-rate.ts";
import { projectRun } from "./flows.ts";
import { maskWideEventForConsole, piiFieldNamesFromManifest } from "./runs-pii.ts";
import { startConsoleApp } from "./serve.ts";

/** Deduplicate console.* flows from the live binding registry. */
function consoleFlows(handle: ConsoleAppHandle) {
  const byName = new Map<string, { readonly name: string; readonly plane: string | undefined }>();
  for (const binding of handle.app.bindings) {
    const name = binding.flow.name;
    if (!name.startsWith("console.")) continue;
    byName.set(name, { name, plane: binding.flow.plane });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const PII_MANIFEST = {
  oke: "1.0" as const,
  app: "security-gate",
  stores: {
    db: {
      facet: "sql" as const,
      tables: {
        bookings: {
          columns: { email: { pii: true }, id: {} },
        },
      },
    },
  },
} satisfies Manifest;

describe("console security gates (whole surface)", () => {
  let cwd: string;
  let handle: ConsoleAppHandle;
  let operatorToken: string;
  let operatorId: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), "oke-console-sec-"));
    handle = await startConsoleApp({
      cwd,
      secret: "test-secret-security-gate",
      silentClaim: true,
      manifest: PII_MANIFEST,
      runsIngestSecret: "gate-ingest-secret",
    });

    const claimRes = await handle.app.fetch(
      new Request("http://console.test/console/setup/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          claimCode: handle.state.claim.code,
          email: "ops@example.com",
          name: "Ops",
          password: "Password1234!",
        }),
      }),
    );
    expect(claimRes.status).toBe(200);
    const claimBody = (await claimRes.json()) as {
      data: { accessToken: string; operatorId: string };
    };
    operatorToken = claimBody.data.accessToken;
    operatorId = claimBody.data.operatorId;
  });

  afterAll(async () => {
    await handle.app.stop();
  });

  test("1. every registered console.* flow is plane:operator and rejects a user principal", async () => {
    const flows = consoleFlows(handle);
    expect(flows.length).toBeGreaterThan(20);

    for (const flow of flows) {
      expect(flow.plane).toBe("operator");
    }

    // HTTP compilers validate the body before the pipeline; walk execute()
    // so beforeHandle (plane check) runs with a user principal regardless of
    // each flow's input schema — same Forbidden the HTTP path returns once
    // the body is well-formed (proven for ping in console.test.ts).
    const failures: string[] = [];
    for (const binding of handle.app.bindings) {
      if (!binding.flow.name.startsWith("console.")) continue;
      const result = await handle.app.execute(binding.flow, {}, binding.trigger, {
        validated: true,
        principal: {
          plane: "user",
          userId: "user-plane-1",
          scopes: ["bookings:create"],
        },
      });
      const code = result.failure?.error?.code;
      if (code !== "Forbidden") {
        failures.push(`${binding.flow.name} → ${code ?? "no-failure"}`);
      }
    }
    expect(failures).toEqual([]);

    // Spot-check the HTTP path still returns 403 Forbidden for a valid body.
    const userSession = await issueSession(
      handle.state.sessions,
      { secret: handle.state.secret, now: handle.state.now },
      {
        id: "user-plane-http",
        plane: "user",
        scopes: ["bookings:create"],
      },
    );
    const httpRes = await handle.app.fetch(
      new Request("http://console.test/console/action/ping", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${userSession.accessToken}`,
        },
        body: JSON.stringify({ note: "escalate" }),
      }),
    );
    expect(httpRes.status).toBe(403);
    const httpBody = (await httpRes.json()) as { error: { code: string } };
    expect(httpBody.error.code).toBe("Forbidden");
  });

  test("5. PII-classified fields are masked on the shared Runs projection", () => {
    const pii = piiFieldNamesFromManifest(handle.state.manifest);
    expect(pii.has("email")).toBe(true);

    const event = {
      id: "run-pii-1",
      flow: "bookings.create",
      trigger: "http",
      plane: "user",
      tenant: null,
      principal: "user-1",
      gates: [],
      cache: "none",
      error: null,
      effects: [],
      logs: [
        {
          level: "info",
          message: "created",
          data: { email: "leak@example.com", id: "b1" },
          at: 1,
        },
      ],
      durationMs: 1,
      startedAt: 1,
      endedAt: 2,
      dimensions: {
        flow: "bookings.create",
        email: "leak@example.com",
        id: "b1",
      },
    } as unknown as WideEvent;

    const masked = maskWideEventForConsole(event, pii);
    expect(masked.dimensions.email).toBe(PII_MASK);
    expect(masked.dimensions.id).toBe("b1");
    expect(masked.logs[0]?.data?.email).toBe(PII_MASK);
    expect(masked.logs[0]?.data?.id).toBe("b1");

    const projected = projectRun(event, pii);
    expect(projected.dimensions.email).toBe(PII_MASK);
    expect(projected.logs[0]?.data?.email).toBe(PII_MASK);
  });

  test("5b. host ingest path cannot surface unmasked PII via GET /console/runs", async () => {
    // Ingest is serve-layer (not a console.* flow) — exercise append + list projection.
    const leak = "ingest-gate@example.com";
    const { handleRunsIngest, RUNS_INGEST_PATH } = await import("./runs-ingest.ts");
    const event = {
      id: "run-ingest-pii",
      flow: "bookings.create",
      unit: "bookings",
      trigger: "http",
      plane: "user" as const,
      gates: [],
      cache: "none" as const,
      effects: [],
      logs: [{ level: "info" as const, message: "x", data: { email: leak }, at: 1 }],
      durationMs: 1,
      startedAt: 1,
      endedAt: 2,
      dimensions: { email: leak, id: "b2" },
      input: { email: leak },
    };
    const ingest = await handleRunsIngest(
      new Request(`http://console.test${RUNS_INGEST_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-oke-runs-ingest": "gate-ingest-secret",
        },
        body: JSON.stringify({ event }),
      }),
      handle,
    );
    expect(ingest.status).toBe(204);

    const listRes = await handle.app.fetch(
      new Request("http://console.test/console/runs", {
        headers: { authorization: `Bearer ${operatorToken}` },
      }),
    );
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as {
      data: {
        runs: readonly { readonly id: string; readonly dimensions: Record<string, unknown> }[];
      };
    };
    const row = body.data.runs.find((r) => r.id === "run-ingest-pii");
    expect(row).toBeDefined();
    expect(row!.dimensions.email).toBe(PII_MASK);
    expect(JSON.stringify(body)).not.toContain(leak);
  });

  test("5c. store browse never returns unmasked PII without reveal; reveal is audited", async () => {
    const leak = "browse-gate@example.com";
    const { defineTable } = await import("../../elements/store.ts");
    const { classify } = await import("../../elements/store/classify.ts");
    const { sql: declareSql } = await import("../../elements/store.ts");
    const bookings = defineTable("bookings", {
      id: true,
      email: classify({ pii: true }),
      seats: true,
    });
    if (!handle.state.storeRuntime) {
      const { createManifestStoreRuntime } = await import("./store.ts");
      handle.state.storeRuntime = await createManifestStoreRuntime(handle.state.manifest);
    }
    handle.state.storeRuntime.register(
      declareSql("db", {
        schema: { bookings },
        classify: { bookings: { email: { pii: true } } },
      }),
    );
    const sqlHandle = (await handle.state.storeRuntime.openRef("sql:db", {
      effects: { writes: ["sql:db"] },
      revealPii: true,
    })) as import("../../elements/store.ts").SqlStoreHandle;
    await sqlHandle.ensureTable(bookings);
    await sqlHandle.insert(bookings).values({ id: "b1", email: leak, seats: 2 });

    const browseRes = await handle.app.fetch(
      new Request("http://console.test/console/store/query", {
        method: "QUERY",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({ ref: "sql:db", child: "bookings" }),
      }),
    );
    expect(browseRes.status).toBe(200);
    const browseBody = (await browseRes.json()) as {
      data: { masked: boolean; rows?: readonly Record<string, unknown>[] };
    };
    expect(browseBody.data.masked).toBe(true);
    expect(browseBody.data.rows?.[0]?.email).toBe(PII_MASK);
    expect(JSON.stringify(browseBody)).not.toContain(leak);

    const revealRes = await handle.app.fetch(
      new Request("http://console.test/console/store/reveal", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({ ref: "sql:db", child: "bookings", id: "b1", column: "email" }),
      }),
    );
    expect(revealRes.status).toBe(200);
    const revealBody = (await revealRes.json()) as { data: { value: unknown } };
    expect(revealBody.data.value).toBe(leak);

    const runs = await handle.state.listRuns();
    const revealRuns = runs.filter((r: WideEvent) => r.flow === "console.store.reveal");
    const revealRun = revealRuns.find((r: WideEvent) =>
      r.logs.some((l) => l.message === "console.store.reveal"),
    );
    expect(revealRun).toBeDefined();
    const audit = revealRun!.logs.find((l) => l.message === "console.store.reveal");
    expect(audit!.data?.ref).toBe("sql:db");
    expect(audit!.data?.child).toBe("bookings");
    expect(audit!.data?.id).toBe("b1");
    expect(audit!.data?.column).toBe("email");
    expect(audit!.data?.operatorId).toBe(operatorId);
  });

  test("5d. store browse revealPii returns cleartext and is audited", async () => {
    const leak = "browse-all@example.com";
    const { defineTable } = await import("../../elements/store.ts");
    const { classify } = await import("../../elements/store/classify.ts");
    const { sql: declareSql } = await import("../../elements/store.ts");
    const bookings = defineTable("bookings", {
      id: true,
      email: classify({ pii: true }),
      seats: true,
    });
    if (!handle.state.storeRuntime) {
      const { createManifestStoreRuntime } = await import("./store.ts");
      handle.state.storeRuntime = await createManifestStoreRuntime(handle.state.manifest);
    }
    handle.state.storeRuntime.register(
      declareSql("db", {
        schema: { bookings },
        classify: { bookings: { email: { pii: true } } },
      }),
    );
    const sqlHandle = (await handle.state.storeRuntime.openRef("sql:db", {
      effects: { writes: ["sql:db"] },
      revealPii: true,
    })) as import("../../elements/store.ts").SqlStoreHandle;
    await sqlHandle.ensureTable(bookings);
    await sqlHandle.insert(bookings).values({ id: "b2", email: leak, seats: 1 });

    const res = await handle.app.fetch(
      new Request("http://console.test/console/store/query", {
        method: "QUERY",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({ ref: "sql:db", child: "bookings", revealPii: true }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { masked: boolean; rows?: readonly Record<string, unknown>[] };
    };
    expect(body.data.masked).toBe(false);
    expect(body.data.rows?.find((r) => r.id === "b2")?.email).toBe(leak);

    const runs = await handle.state.listRuns();
    const queryRuns = runs.filter((r: WideEvent) => r.flow === "console.store.query");
    const auditRun = queryRuns.find((r: WideEvent) =>
      r.logs.some((l) => l.message === "console.store.query.reveal"),
    );
    expect(auditRun).toBeDefined();
    const audit = auditRun!.logs.find((l) => l.message === "console.store.query.reveal");
    expect(audit!.data?.ref).toBe("sql:db");
    expect(audit!.data?.child).toBe("bookings");
    expect(audit!.data?.operatorId).toBe(operatorId);
  });

  test("5e. store SQL masks PII unless revealPii; reveal is audited", async () => {
    const leak = "sql-console@example.com";
    const { defineTable } = await import("../../elements/store.ts");
    const { classify } = await import("../../elements/store/classify.ts");
    const { sql: declareSql } = await import("../../elements/store.ts");
    const bookings = defineTable("bookings", {
      id: true,
      email: classify({ pii: true }),
      seats: true,
    });
    if (!handle.state.storeRuntime) {
      const { createManifestStoreRuntime } = await import("./store.ts");
      handle.state.storeRuntime = await createManifestStoreRuntime(handle.state.manifest);
    }
    handle.state.storeRuntime.register(
      declareSql("db", {
        schema: { bookings },
        classify: { bookings: { email: { pii: true } } },
      }),
    );
    const sqlHandle = (await handle.state.storeRuntime.openRef("sql:db", {
      effects: { writes: ["sql:db"] },
      revealPii: true,
    })) as import("../../elements/store.ts").SqlStoreHandle;
    await sqlHandle.ensureTable(bookings);
    await sqlHandle.insert(bookings).values({ id: "b3", email: leak, seats: 1 });

    const maskedRes = await handle.app.fetch(
      new Request("http://console.test/console/store/sql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({ ref: "sql:db", sql: `SELECT * FROM "bookings" WHERE "id" = 'b3'` }),
      }),
    );
    expect(maskedRes.status).toBe(200);
    const maskedBody = (await maskedRes.json()) as {
      data: { masked: boolean; rows?: readonly Record<string, unknown>[] };
    };
    expect(maskedBody.data.masked).toBe(true);
    expect(maskedBody.data.rows?.[0]?.email).toBe(PII_MASK);
    expect(JSON.stringify(maskedBody)).not.toContain(leak);

    const revealRes = await handle.app.fetch(
      new Request("http://console.test/console/store/sql", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({
          ref: "sql:db",
          sql: `SELECT * FROM "bookings" WHERE "id" = 'b3'`,
          revealPii: true,
        }),
      }),
    );
    expect(revealRes.status).toBe(200);
    const revealBody = (await revealRes.json()) as {
      data: { masked: boolean; rows?: readonly Record<string, unknown>[] };
    };
    expect(revealBody.data.masked).toBe(false);
    expect(revealBody.data.rows?.[0]?.email).toBe(leak);

    const runs = await handle.state.listRuns();
    const sqlRuns = runs.filter((r: WideEvent) => r.flow === "console.store.sql");
    const auditRun = sqlRuns.find((r: WideEvent) =>
      r.logs.some((l) => l.message === "console.store.sql.reveal"),
    );
    expect(auditRun).toBeDefined();
    const audit = auditRun!.logs.find((l) => l.message === "console.store.sql.reveal");
    expect(audit!.data?.ref).toBe("sql:db");
    expect(audit!.data?.operatorId).toBe(operatorId);
  });

  test("5f. store SQL lock reveal is audited as console.store.sql.stats.reveal", async () => {
    const res = await handle.app.fetch(
      new Request("http://console.test/console/store/sql/locks", {
        method: "QUERY",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${operatorToken}`,
        },
        body: JSON.stringify({ ref: "sql:db", revealPii: true }),
      }),
    );
    expect(res.status).not.toBe(401);
    const runs = await handle.state.listRuns();
    const lockRuns = runs.filter((r: WideEvent) => r.flow === "console.store.sql.locks");
    const auditRun = lockRuns.find((r: WideEvent) =>
      r.logs.some((l) => l.message === "console.store.sql.stats.reveal"),
    );
    expect(auditRun).toBeDefined();
    const audit = auditRun!.logs.find((l) => l.message === "console.store.sql.stats.reveal");
    expect(audit!.data?.ref).toBe("sql:db");
    expect(audit!.data?.operatorId).toBe(operatorId);
  });

  test("7. every registered console.* flow leaves a Runs entry when executed", async () => {
    const flows = consoleFlows(handle);
    const before = new Set((await handle.state.listRuns()).map((r: WideEvent) => r.flow));

    for (const flowMeta of flows) {
      if (before.has(flowMeta.name)) continue;
      const binding = handle.app.bindings.find((b: Binding) => b.flow.name === flowMeta.name);
      expect(binding).toBeDefined();
      try {
        await handle.app.execute(binding!.flow, {}, binding!.trigger, {
          validated: true,
          principal: {
            plane: "operator",
            operatorId,
          },
        });
      } catch {
        // Handler throws still record a wide event (pipeline catches).
      }
    }

    const after = await handle.state.listRuns();
    const names = new Set(after.map((r: WideEvent) => r.flow));
    const missing = flows.map((f) => f.name).filter((name) => !names.has(name));
    expect(missing).toEqual([]);
  });

  test("8. operator login is rate-limited (5 / 60s) like setup-claim", async () => {
    for (let i = 0; i < AUTH_RATE_LIMIT; i++) {
      const res = await handle.app.fetch(
        new Request("http://console.test/console/session/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: "ops@example.com",
            password: "wrong-password",
          }),
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("AuthFailed");
    }

    const limited = await handle.app.fetch(
      new Request("http://console.test/console/session/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "ops@example.com",
          password: "Password1234!",
        }),
      }),
    );
    expect(limited.status).toBe(400);
    const limitedBody = (await limited.json()) as {
      error: { code: string };
    };
    expect(limitedBody.error.code).toBe("AuthRateLimited");

    // Sanity: a different email still authenticates under its own bucket.
    // (No second operator — AuthFailed, not rate-limited.)
    const other = await handle.app.fetch(
      new Request("http://console.test/console/session/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "other@example.com",
          password: "Password1234!",
        }),
      }),
    );
    const otherBody = (await other.json()) as { error: { code: string } };
    expect(otherBody.error.code).toBe("AuthFailed");

    void operatorToken;
  });
});
