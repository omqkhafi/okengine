/**
 * Regression: `console.runs.list` must not nest its own projection into the
 * runs store (exponential payload growth → Console kernel OOM on poll).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WideEvent } from "../../runs/types.ts";
import { serveConsole, type ConsoleServerHandle } from "./serve.ts";

const HOST_RUN: WideEvent = {
  id: "host-run-1",
  flow: "bookings.create",
  unit: "bookings",
  trigger: "http",
  plane: "user",
  gates: [],
  cache: "none",
  effects: [],
  logs: [],
  durationMs: 10,
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_000_010,
  dimensions: { flow: "bookings.create" },
  input: { flightId: "SK-101", seats: 1 },
  output: { id: "b1" },
};

describe("console.runs.list nesting", () => {
  let cwd: string;
  let server: ConsoleServerHandle;
  let token: string;

  beforeAll(async () => {
    cwd = await mkdtemp(join(tmpdir(), "oke-runs-list-nest-"));
    server = await serveConsole({
      port: 0,
      hostname: "127.0.0.1",
      cwd,
      persist: false,
      silentClaim: true,
      env: "test",
      secret: "test-runs-list-nest-secret",
    });
    const claim = await fetch(`${server.url}/console/setup/claim`, {
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
    const body = (await claim.json()) as { data: { accessToken: string } };
    token = body.data.accessToken;

    const runs = server.console.app.bootResult?.runs;
    expect(runs).toBeDefined();
    await runs!.append(HOST_RUN);
  });

  afterAll(() => {
    server.stop(true);
  });

  test("repeated GET /console/runs does not explode stored event size", async () => {
    const sizes: number[] = [];
    let lastCount: number | null = null;

    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${server.url}/console/runs`, {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        data: { runs: readonly { readonly flow: string }[] };
      };
      expect(json.data.runs.some((r) => r.flow === "console.runs.list")).toBe(false);
      if (lastCount === null) lastCount = json.data.runs.length;
      else expect(json.data.runs.length).toBe(lastCount);

      const all = await server.console.state.listRuns();
      const max = Math.max(...all.map((r) => JSON.stringify(r).length));
      sizes.push(max);
    }

    const first = sizes[0]!;
    const last = sizes[sizes.length - 1]!;
    // Exponential nesting would be ~2^11×; allow modest linear noise only.
    expect(last).toBeLessThan(first * 4);
    expect(last).toBeLessThan(200_000);
  });
});
