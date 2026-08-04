/**
 * Kernel readiness endpoint — boot vs orphan_scan vs ready.
 */

import { describe, expect, test } from "bun:test";

import { oke } from "./app.ts";
import { flow, type AnyFlowDef } from "./flow.ts";
import { createMemoryJournalStore, hasJournalLease } from "./journal.ts";
import type { Binding } from "./on.ts";
import { http } from "./triggers.ts";
import { gate } from "../elements/gate.ts";

describe("GET /_/ready", () => {
  test("returns 503 booting before boot, 200 ready after boot without journal", async () => {
    const app = oke({
      name: "ready-plain",
      autoBoot: false,
      startScheduler: false,
    });
    const before = await app.fetch(new Request("http://127.0.0.1/_/ready"));
    expect(before.status).toBe(503);
    expect(await before.json()).toEqual({ ready: false, reason: "booting" });

    await app.boot();
    expect(app.readyState).toBe("ready");
    const after = await app.fetch(new Request("http://127.0.0.1/_/ready"));
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({ ready: true });
    await app.stop();
  });

  test("orphan_scan then ready when durable journal is bound", async () => {
    const journalStore = createMemoryJournalStore();
    expect(hasJournalLease(journalStore)).toBe(true);
    const charge = flow({
      name: "charge",
      durable: true,
      do: () => ({ ok: true }),
    });
    const bindings: Binding[] = [
      {
        trigger: http.post("/charge").gate(gate.public),
        flow: charge as AnyFlowDef,
      },
    ];
    const app = oke({
      name: "ready-journal",
      autoBoot: false,
      startScheduler: false,
      env: "test",
      gate: { unguardedHttp: "allow" },
      bindings,
      elements: {
        journal: {
          store: journalStore,
          instanceId: "ready-j",
          leaseMs: 30_000,
          driverId: "memory",
        },
      },
    });
    await app.boot();
    // Memory journal orphan scan is fast — may already be ready; accept either
    // intermediate orphan_scan or ready, but never stay booting after boot().
    expect(["orphan_scan", "ready"]).toContain(app.readyState);
    const deadline = Date.now() + 2_000;
    while (app.readyState !== "ready" && Date.now() < deadline) {
      await Bun.sleep(5);
    }
    expect(app.readyState).toBe("ready");
    const res = await app.fetch(new Request("http://127.0.0.1/_/ready"));
    expect(res.status).toBe(200);
    await app.stop();
  });
});
