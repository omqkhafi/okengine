/**
 * Console runs SQL — adversarial guard, sandbox, caps, mask, Prerequisite C.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PII_MASK } from "../../elements/store/classify.ts";
import { memoryFilesDriver } from "../../drivers/memory.ts";
import type { FilesBucket } from "../../drivers/types.ts";
import type { Manifest } from "../../manifest/types.ts";
import { createRunsRuntime, type WideEvent } from "../../runs/index.ts";
import { piiFieldNamesFromManifest } from "./runs-pii.ts";
import { ConsoleRunsQueryError, runConsoleRunsQuery } from "./runs-query.ts";
import { serveConsole, type ConsoleServerHandle } from "./serve.ts";

const LEAK = "runs-query@example.com";

const PII_MANIFEST = {
  oke: "1.0" as const,
  app: "runs-query",
  stores: {
    db: {
      facet: "sql" as const,
      tables: {
        bookings: { columns: { email: { pii: true }, id: {} } },
      },
    },
  },
} satisfies Manifest;

function sample(id: string, startedAt: number): WideEvent {
  return {
    id,
    flow: "bookings.create",
    trigger: "http",
    plane: "user",
    gates: [],
    cache: "none",
    effects: [],
    logs: [],
    durationMs: 4,
    startedAt,
    endedAt: startedAt + 4,
    dimensions: { email: LEAK, id },
    input: { email: LEAK, id },
    output: { ok: true },
    error: null,
  };
}

function wrapGets(inner: FilesBucket): FilesBucket & { gets: number } {
  const wrapped = {
    driverId: inner.driverId,
    gets: 0,
    put: inner.put.bind(inner),
    async get(key: string) {
      wrapped.gets += 1;
      return inner.get(key);
    },
    delete: inner.delete.bind(inner),
    list: inner.list.bind(inner),
    close: inner.close.bind(inner),
  };
  return wrapped;
}

describe("runConsoleRunsQuery", () => {
  const temps: string[] = [];

  afterEach(async () => {
    for (const t of temps.splice(0)) {
      await rm(t, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("masks dim_* and JSON; alias leak remains (named gap)", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-rq-mask-"));
    temps.push(root);
    const runs = createRunsRuntime({ driver: "files", localRoot: root });
    await runs.open();
    await runs.append(sample("r1", Date.now()));
    await runs.flush();
    const pii = piiFieldNamesFromManifest(PII_MANIFEST);

    const masked = await runConsoleRunsQuery({
      runtime: runs,
      sql: "SELECT id, dim_email, input FROM runs",
      piiFields: pii,
    });
    expect(masked.limitation).toBe("RunsQueryPiiProjectionGap");
    expect(masked.masked).toBe("column-keys");
    expect(masked.rows[0]!.dim_email).toBe(PII_MASK);
    const input = JSON.parse(String(masked.rows[0]!.input)) as { email: string };
    expect(input.email).toBe(PII_MASK);
    expect(JSON.stringify(masked.rows)).not.toContain(LEAK);

    const aliased = await runConsoleRunsQuery({
      runtime: runs,
      sql: "SELECT dim_email AS e FROM runs",
      piiFields: pii,
    });
    expect(aliased.rows[0]!.e).toBe(LEAK);

    await runs.close();
  });

  test("rejects DuckDB bypass classes before execute", async () => {
    const runs = createRunsRuntime({ driver: "memory" });
    await runs.open();
    const pii = new Set<string>();
    const attacks = [
      "FROM read_csv('/etc/passwd')",
      "WITH x AS (SELECT 1 AS n) INSERT INTO runs SELECT * FROM x",
      "INSTALL httpfs",
      "LOAD httpfs",
      "ATTACH '/tmp/other.db'",
      "PRAGMA show_tables",
      "SET enable_external_access = true",
      "SELECT * FROM read_parquet('/tmp/other.parquet')",
    ];
    for (const sql of attacks) {
      try {
        await runConsoleRunsQuery({ runtime: runs, sql, piiFields: pii });
        throw new Error(`expected reject: ${sql}`);
      } catch (err) {
        expect(err).toBeInstanceOf(ConsoleRunsQueryError);
        expect((err as ConsoleRunsQueryError).code).toBe("QueryRejected");
      }
    }
    await runs.close();
  });

  test("sandbox blocks read_parquet even if the guard is skipped", async () => {
    const root = await mkdtemp(join(tmpdir(), "oke-rq-sand-"));
    temps.push(root);
    const runs = createRunsRuntime({ driver: "files", localRoot: root });
    await runs.open();
    await runs.append(sample("r1", Date.now()));
    await runs.flush();
    let failed = false;
    try {
      await runs.query("SELECT * FROM read_parquet('/tmp/oke-does-not-exist.parquet')", {
        sandbox: true,
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    await runs.close();
  });

  test("row cap truncates and timeout fires", async () => {
    const runs = createRunsRuntime({ driver: "memory" });
    await runs.open();
    const now = Date.now();
    for (let i = 0; i < 12; i += 1) {
      await runs.append(sample(`r${i}`, now + i));
    }
    const capped = await runConsoleRunsQuery({
      runtime: runs,
      sql: "SELECT id FROM runs",
      piiFields: new Set(),
      maxRows: 5,
    });
    expect(capped.rowCount).toBe(5);
    expect(capped.truncated).toBe(true);

    try {
      await runConsoleRunsQuery({
        runtime: runs,
        sql: "SELECT count(*) AS n FROM range(1000000000)",
        piiFields: new Set(),
        timeoutMs: 40,
      });
      throw new Error("expected timeout");
    } catch (err) {
      expect(
        err instanceof ConsoleRunsQueryError ||
          (err instanceof Error && err.name === "DuckQueryTimeoutError"),
      ).toBe(true);
    }
    await runs.close();
  });

  test("Prerequisite C — second identical query does not re-copy unchanged partitions", async () => {
    const inner = await memoryFilesDriver.open({ name: "runs-c" });
    const bucket = wrapGets(inner);
    const runs = createRunsRuntime({
      driver: "files",
      localBucket: bucket,
    });
    await runs.open();
    await runs.append(sample("keep", Date.now()));
    await runs.flush();
    const first = await runs.query("SELECT id FROM runs");
    expect(first.map((r) => String(r.id))).toEqual(["keep"]);
    const afterFirst = bucket.gets;
    expect(afterFirst).toBeGreaterThan(0);
    await runs.query("SELECT id FROM runs");
    expect(bucket.gets).toBe(afterFirst);
    await runs.close();
    await inner.close();
  });
});

describe("POST /console/runs/query", () => {
  const temps: string[] = [];
  const servers: ConsoleServerHandle[] = [];

  afterEach(async () => {
    for (const s of servers.splice(0)) s.stop(true);
    for (const t of temps.splice(0)) {
      await rm(t, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("operator session required; SELECT is masked", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-rq-http-"));
    temps.push(cwd);
    const host = createRunsRuntime({
      driver: "files",
      localRoot: join(cwd, ".oke/runs"),
    });
    await host.open();
    await host.append(sample("http1", Date.now()));
    await host.flush();
    await host.close();

    const server = await serveConsole({
      port: 0,
      hostname: "127.0.0.1",
      cwd,
      env: "test",
      persist: false,
      silentClaim: true,
      secret: "test-console-secret-runs-query",
      manifest: PII_MANIFEST,
    });
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;

    const anon = await fetch(`${base}/console/runs/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sql: "SELECT id FROM runs" }),
    });
    expect(anon.status).toBe(401);

    const claim = await fetch(`${base}/console/setup/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        claimCode: server.console.state.claim.code,
        email: "ops@example.com",
        name: "Ops",
        password: "Password1234!",
      }),
    });
    expect(claim.status).toBe(200);
    const claimed = (await claim.json()) as { data: { accessToken: string } };
    const token = claimed.data.accessToken;

    const res = await fetch(`${base}/console/runs/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sql: "SELECT id, dim_email FROM runs" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        rows: readonly { readonly id: string; readonly dim_email: unknown }[];
        limitation: string;
        masked: string;
      };
    };
    expect(body.data.limitation).toBe("RunsQueryPiiProjectionGap");
    expect(body.data.masked).toBe("column-keys");
    expect(body.data.rows[0]!.id).toBe("http1");
    expect(body.data.rows[0]!.dim_email).toBe(PII_MASK);
    expect(JSON.stringify(body)).not.toContain(LEAK);
  });
});
