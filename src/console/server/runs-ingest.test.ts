/**
 * Host → Console WideEvent ingest bridge (oke dev live Traces).
 *
 * Proves the real boundary: host record → POST ingest → Console append →
 * masked `GET /console/runs` + `/console/live` — never raw PII on those paths.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { gate } from "../../elements/gate.ts";
import { PII_MASK } from "../../elements/store/classify.ts";
import { oke } from "../../kernel/app.ts";
import { flow, resetFlowSeq } from "../../kernel/flow.ts";
import { on, resetBindings } from "../../kernel/on.ts";
import { http } from "../../kernel/triggers.ts";
import type { Manifest } from "../../manifest/types.ts";
import { RUNS_INGEST_SECRET_HEADER, type WideEvent } from "../../runs/index.ts";
import { subscribeLive } from "./live.ts";
import type { ConsoleAppHandle } from "./app.ts";
import { handleRunsIngest, RUNS_INGEST_PATH } from "./runs-ingest.ts";
import { serveConsole, type ConsoleServerHandle } from "./serve.ts";
import type { ConsoleLiveMessage } from "./state.ts";

const INGEST_SECRET = "test-runs-ingest-secret-bridge";
const LEAK_EMAIL = "host-leak@example.com";

const PII_MANIFEST = {
  oke: "1.0" as const,
  app: "runs-ingest-bridge",
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

function hostWideEvent(overrides: Partial<WideEvent> = {}): WideEvent {
  const startedAt = 1_700_000_000_000;
  return {
    id: overrides.id ?? `run_${crypto.randomUUID()}`,
    flow: "bookings.create",
    unit: "bookings",
    trigger: "http",
    plane: "user",
    gates: [],
    cache: "none",
    effects: [],
    logs: [
      {
        level: "info",
        message: "created",
        data: { email: LEAK_EMAIL, id: "b1" },
        at: startedAt,
      },
    ],
    durationMs: 4,
    startedAt,
    endedAt: startedAt + 4,
    dimensions: {
      flow: "bookings.create",
      email: LEAK_EMAIL,
      id: "b1",
    },
    input: { email: LEAK_EMAIL, id: "b1" },
    output: { ok: true },
    ...overrides,
  };
}

describe("console runs ingest bridge", () => {
  let cwd: string;
  let server: ConsoleServerHandle;
  let operatorToken: string;
  let base: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), "oke-runs-ingest-"));
    server = await serveConsole({
      port: 0,
      hostname: "127.0.0.1",
      cwd,
      env: "test",
      persist: false,
      silentClaim: true,
      secret: "test-console-secret-ingest",
      runsIngestSecret: INGEST_SECRET,
      manifest: PII_MANIFEST,
    });
    base = `http://127.0.0.1:${server.port}`;

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
    const claimBody = (await claimRes.json()) as {
      data: { accessToken: string };
    };
    operatorToken = claimBody.data.accessToken;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("rejects missing / wrong ingest secret", async () => {
    const event = hostWideEvent();
    const missing = await server.fetch(
      new Request(`${base}${RUNS_INGEST_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: `127.0.0.1:${server.port}`,
        },
        body: JSON.stringify({ event }),
      }),
    );
    expect(missing.status).toBe(401);

    const wrong = await server.fetch(
      new Request(`${base}${RUNS_INGEST_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: `127.0.0.1:${server.port}`,
          [RUNS_INGEST_SECRET_HEADER]: "wrong-secret",
        },
        body: JSON.stringify({ event }),
      }),
    );
    expect(wrong.status).toBe(401);
  });

  test("ingest never echoes the WideEvent body", async () => {
    const event = hostWideEvent({ id: "run_no_echo" });
    const res = await server.fetch(
      new Request(`${base}${RUNS_INGEST_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: `127.0.0.1:${server.port}`,
          [RUNS_INGEST_SECRET_HEADER]: INGEST_SECRET,
        },
        body: JSON.stringify({ event }),
      }),
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  test("adversarial: host PII never reaches GET /console/runs unmasked", async () => {
    const event = hostWideEvent({ id: "run_pii_http" });
    const ingest = await server.fetch(
      new Request(`${base}${RUNS_INGEST_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: `127.0.0.1:${server.port}`,
          [RUNS_INGEST_SECRET_HEADER]: INGEST_SECRET,
        },
        body: JSON.stringify({ event }),
      }),
    );
    expect(ingest.status).toBe(204);

    // Store still holds cleartext server-side (masking is a read projection).
    const raw = await server.console.state.listRuns();
    const stored = raw.find((r) => r.id === "run_pii_http");
    expect(stored?.dimensions.email).toBe(LEAK_EMAIL);

    const listRes = await server.fetch(
      new Request(`${base}/console/runs`, {
        headers: {
          host: `127.0.0.1:${server.port}`,
          authorization: `Bearer ${operatorToken}`,
        },
      }),
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      data: {
        runs: readonly {
          readonly id: string;
          readonly dimensions: Record<string, unknown>;
          readonly logs: readonly { readonly data?: Record<string, unknown> }[];
          readonly input: Record<string, unknown> | null;
        }[];
      };
    };
    const row = listBody.data.runs.find((r) => r.id === "run_pii_http");
    expect(row).toBeDefined();
    expect(row!.dimensions.email).toBe(PII_MASK);
    expect(row!.dimensions.id).toBe("b1");
    expect(row!.logs[0]?.data?.email).toBe(PII_MASK);
    expect((row!.input as { email?: string } | null)?.email).toBe(PII_MASK);

    const wire = JSON.stringify(listBody);
    expect(wire).not.toContain(LEAK_EMAIL);
    expect(wire).toContain(PII_MASK);
  });

  test("adversarial: live /console/live run messages are masked", async () => {
    const messages: ConsoleLiveMessage[] = [];
    const unsub = subscribeLive(server.console.state, (m) => messages.push(m));

    const event = hostWideEvent({ id: "run_pii_live" });
    const ingest = await handleRunsIngest(
      new Request(`http://console.test${RUNS_INGEST_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [RUNS_INGEST_SECRET_HEADER]: INGEST_SECRET,
        },
        body: JSON.stringify({ event }),
      }),
      server.console,
    );
    expect(ingest.status).toBe(204);
    unsub();

    const live = messages.find((m) => m.type === "run" && m.run.id === "run_pii_live");
    expect(live).toBeDefined();
    if (live?.type !== "run") return;
    expect(live.run.dimensions.email).toBe(PII_MASK);
    expect(live.run.logs[0]?.data?.email).toBe(PII_MASK);
    expect(JSON.stringify(live)).not.toContain(LEAK_EMAIL);
  });

  test("host app execution bridges into Console listRuns (boot-level)", async () => {
    resetBindings();
    resetFlowSeq();
    const publicGate = gate.public;
    on(
      http.post("/bookings").gate(publicGate),
      flow("bookings.create", {
        plane: "user",
        in: z.object({ email: z.string(), id: z.string() }),
        out: z.object({ ok: z.boolean() }),
        do: (input, fx) => {
          fx.log.info("created", { email: input.email, id: input.id });
          return { ok: true };
        },
      }),
    );

    const bridge = {
      url: `${base}${RUNS_INGEST_PATH}`,
      secret: INGEST_SECRET,
      fetch: (input: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        headers.set("host", `127.0.0.1:${server.port}`);
        return server.fetch(new Request(input, { ...init, headers }));
      },
    };
    const host = oke({
      name: "host-bridge",
      registry: "consume",
      env: "test",
      runsBridge: bridge,
    });
    await host.boot({
      env: "test",
      docker: false,
      unguardedHttp: "allow",
      runsBridge: bridge,
    });

    expect(host.bootResult?.runs).toBeDefined();

    const res = await host.fetch(
      new Request("http://host.test/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: LEAK_EMAIL, id: "b-host" }),
      }),
    );
    expect(res.status).toBe(200);

    // Host recorded locally.
    const hostRuns = await host.bootResult!.runs!.all();
    expect(hostRuns.length).toBeGreaterThan(0);
    const hostEvent = hostRuns[hostRuns.length - 1]!;
    expect(hostEvent.flow).toBe("bookings.create");
    expect((hostEvent.input as { id?: string } | undefined)?.id).toBe("b-host");

    // Console received the bridged event (same id as host).
    const consoleRuns = await server.console.state.listRuns();
    const bridged = consoleRuns.find((r) => r.id === hostEvent.id);
    expect(bridged).toBeDefined();
    expect((bridged!.input as { email?: string } | undefined)?.email).toBe(LEAK_EMAIL);

    const listRes = await server.fetch(
      new Request(`${base}/console/runs`, {
        headers: {
          host: `127.0.0.1:${server.port}`,
          authorization: `Bearer ${operatorToken}`,
        },
      }),
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      data: {
        runs: readonly {
          readonly id: string;
          readonly input: Record<string, unknown> | null;
          readonly logs: readonly { readonly data?: Record<string, unknown> }[];
        }[];
      };
    };
    const row = listBody.data.runs.find((r) => r.id === bridged!.id);
    expect(row).toBeDefined();
    expect(row!.input?.email).toBe(PII_MASK);
    expect(row!.logs.some((l) => l.data?.email === PII_MASK)).toBe(true);
    expect(JSON.stringify(row)).not.toContain(LEAK_EMAIL);

    await host.stop();
    resetBindings();
  });

  test("ingest disabled when runsIngestSecret is null", async () => {
    const closed = await serveConsole({
      port: 0,
      hostname: "127.0.0.1",
      cwd,
      env: "test",
      persist: false,
      silentClaim: true,
      secret: "other-secret",
      // no runsIngestSecret
    });
    try {
      const res = await closed.fetch(
        new Request(`http://127.0.0.1:${closed.port}${RUNS_INGEST_PATH}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: `127.0.0.1:${closed.port}`,
            [RUNS_INGEST_SECRET_HEADER]: "anything",
          },
          body: JSON.stringify({ event: hostWideEvent() }),
        }),
      );
      expect(res.status).toBe(404);
    } finally {
      closed.stop(true);
    }
  });

  test("non-POST ingest returns 405 with Allow: POST", async () => {
    const res = await handleRunsIngest(
      new Request("http://console.test/console/runs/ingest", { method: "GET" }),
      { state: { runsIngestSecret: INGEST_SECRET } } as ConsoleAppHandle,
    );
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("POST");
  });
});
