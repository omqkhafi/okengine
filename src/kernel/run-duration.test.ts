/**
 * Execute records high-res duration when the app clock does not tick.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { oke } from "./app.ts";
import { flow } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { http } from "./triggers.ts";
import { createRunsRuntime } from "../runs/runtime.ts";

const prevRequestLog = process.env.OKE_DEV_REQUEST_LOG;

afterEach(() => {
  resetBindings();
  if (prevRequestLog === undefined) delete process.env.OKE_DEV_REQUEST_LOG;
  else process.env.OKE_DEV_REQUEST_LOG = prevRequestLog;
});

describe("execute run duration", () => {
  test("frozen Date.now still records a positive high-res duration", async () => {
    const runs = createRunsRuntime({ driver: "memory" });
    await runs.open();

    on(
      http.get("/ping").gate.public,
      flow("demo.ping", {
        do: () => ({ ok: true }),
      }),
    );

    const app = oke({
      name: "run-duration",
      runs,
      env: "test",
      fx: { now: () => 1_700_000_000_000 },
    });
    await app.boot({ env: "test", runs });

    const matched = app.router.match("GET", "/ping");
    expect(matched).toBeTruthy();
    const result = await app.execute(matched!.value.flow, {}, matched!.value.trigger);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.runId.length).toBeGreaterThan(0);

    await runs.flush();
    const events = await runs.all();
    expect(events).toHaveLength(1);
    expect(events[0]!.id).toBe(result.runId);
    expect(events[0]!.startedAt).toBe(1_700_000_000_000);
    expect(events[0]!.endedAt).toBe(1_700_000_000_000);
    expect(events[0]!.durationMs).toBeGreaterThan(0);
    expect(events[0]!.durationMs).toBe(result.durationMs);

    await runs.close();
  });

  test("fetch request log includes the run id", async () => {
    process.env.OKE_DEV_REQUEST_LOG = "1";
    const chunks: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stdout.write;

    const runs = createRunsRuntime({ driver: "memory" });
    await runs.open();
    try {
      on(
        http.get("/ping").gate.public,
        flow("demo.ping", {
          do: () => ({ ok: true }),
        }),
      );
      const app = oke({ name: "run-log", runs, env: "test" });
      await app.boot({ env: "test", runs });

      const res = await app.fetch(new Request("http://localhost/ping"));
      expect(res.status).toBe(200);
      await runs.flush();
      const events = await runs.all();
      expect(events).toHaveLength(1);
      const logged = chunks.join("");
      expect(logged).toContain("demo.ping");
      expect(logged).toContain(events[0]!.id);
    } finally {
      process.stdout.write = write;
      await runs.close();
    }
  });
});
