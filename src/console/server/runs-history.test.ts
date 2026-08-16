/**
 * Console historical listRuns — host Parquet on disk survives a Console restart.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PII_MASK } from "../../elements/store/classify.ts";
import type { Manifest } from "../../manifest/types.ts";
import { createRunsRuntime, DEFAULT_RUNS_LOCAL_ROOT, type WideEvent } from "../../runs/index.ts";
import { serveConsole, type ConsoleServerHandle } from "./serve.ts";

const LEAK_EMAIL = "history-leak@example.com";

const PII_MANIFEST = {
  oke: "1.0" as const,
  app: "runs-history",
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
  flows: {
    "bookings.create": { plane: "user" as const },
  },
} satisfies Manifest;

function hostEvent(): WideEvent {
  const startedAt = 1_700_000_000_000;
  return {
    id: "run_disk_history",
    flow: "bookings.create",
    unit: "bookings",
    trigger: "http",
    plane: "user",
    gates: [],
    cache: "none",
    effects: [],
    logs: [],
    durationMs: 4,
    startedAt,
    endedAt: startedAt + 4,
    dimensions: { flow: "bookings.create", email: LEAK_EMAIL, id: "b1" },
    input: { email: LEAK_EMAIL, id: "b1" },
    output: { ok: true },
    error: null,
  };
}

describe("console historical listRuns from disk", () => {
  const temps: string[] = [];
  const servers: ConsoleServerHandle[] = [];

  afterEach(async () => {
    for (const s of servers.splice(0)) s.stop(true);
    for (const t of temps.splice(0)) {
      await rm(t, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  test("Console restart lists masked host runs from .oke/runs", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "oke-runs-hist-"));
    temps.push(cwd);

    const host = createRunsRuntime({
      driver: "files",
      localRoot: join(cwd, DEFAULT_RUNS_LOCAL_ROOT),
    });
    await host.open();
    await host.append(hostEvent());
    await host.flush();
    await host.close();

    const server = await serveConsole({
      port: 0,
      hostname: "127.0.0.1",
      cwd,
      env: "test",
      persist: false,
      silentClaim: true,
      secret: "test-console-secret-history",
      manifest: PII_MANIFEST,
    });
    servers.push(server);
    const base = `http://127.0.0.1:${server.port}`;

    const live = server.console.app.bootResult?.runs
      ? await server.console.app.bootResult.runs.all()
      : [];
    expect(live.some((e) => e.id === "run_disk_history")).toBe(false);

    const listed = await server.console.state.listRuns();
    expect(listed.some((e) => e.id === "run_disk_history")).toBe(true);

    const claimRes = await server.fetch(
      new Request(`${base}/console/setup/claim`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: `127.0.0.1:${server.port}`,
        },
        body: JSON.stringify({
          claimCode: server.console.state.claim.code,
          email: "ops@example.com",
          name: "Ops",
          password: "Password1234!",
        }),
      }),
    );
    expect(claimRes.status).toBe(200);
    const claimBody = (await claimRes.json()) as { data: { accessToken: string } };

    const listRes = await server.fetch(
      new Request(`${base}/console/runs`, {
        headers: {
          host: `127.0.0.1:${server.port}`,
          authorization: `Bearer ${claimBody.data.accessToken}`,
        },
      }),
    );
    expect(listRes.status).toBe(200);
    const body = (await listRes.json()) as {
      data: {
        runs: readonly {
          readonly id: string;
          readonly input: Record<string, unknown> | null;
          readonly dimensions: Record<string, unknown>;
        }[];
      };
    };
    const row = body.data.runs.find((r) => r.id === "run_disk_history");
    expect(row).toBeDefined();
    expect(row!.input?.email).toBe(PII_MASK);
    expect(row!.dimensions.email).toBe(PII_MASK);
    expect(JSON.stringify(body)).not.toContain(LEAK_EMAIL);
  });
});
