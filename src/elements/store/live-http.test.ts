/**
 * Manual live query e2e — a hand-written flow on `.live(table)` streams
 * classified CDC events through `liveQuery` over real pglite + RLS.
 *
 * Proves the full manual path: declaration (`http.get(...).live(tasks)`) →
 * compiled Manifest (signal synthesis + guardrails, covered in
 * extract.test.ts) → real boot (realtime bridge binds, CDC sink live) →
 * hand-written flow body calls `liveQuery(fx, tasks, input)` → SSE frames
 * carry only the subscriber's rows — cross-table writes (activity) never
 * appear (see live-isolation.test.ts for the adversarial leg).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { gate } from "../gate.ts";
import { oke } from "../../kernel/app.ts";
import { flow, resetFlowSeq } from "../../kernel/flow.ts";
import { on, resetBindings } from "../../kernel/on.ts";
import { http } from "../../kernel/triggers.ts";
import { createTestApp } from "../../test/create-test-app.ts";
import { field, id, store } from "../store.ts";
import { liveQuery } from "./live-query.ts";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
});

const tasks = store.schema.table("tasks", {
  id: field.text().primaryKey().defaultFn(id),
  title: field.text().notNull(),
  status: field.text().notNull(),
});

const activity = store.schema.table("activity", {
  id: field.text().primaryKey().defaultFn(id),
  label: field.text().notNull(),
});

describe("manual live flow (.live(table) + liveQuery) — real boot", () => {
  test("SSE frames carry classified task events; activity writes never surface", async () => {
    resetBindings();
    resetFlowSeq();

    const db = store.sql("app", { schema: { tasks, activity } });

    const tasksLive = on(
      http.get("/tasks/live").public().live(tasks),
      flow("tasks.live", {
        in: { unknown: true },
        effects: { reads: ["sql:app"] },
        do: async (input, fx) =>
          liveQuery(fx, tasks, input, {
            filter: [tasks.status],
            search: [tasks.title],
            order: "all",
          }),
      }),
    );
    // A plain flow writing to BOTH tables — the keel `writeActivity` shape.
    const createTask = on(
      http.post("/tasks").public(),
      flow("tasks.create", {
        in: { title: { type: "string" }, status: { type: "string" } },
        effects: { writes: ["sql:app"] },
        do: async (input, fx) => {
          const s = fx.store(db);
          await s.insert(tasks).values({
            title: String((input as { title: unknown }).title),
            status: String((input as { status: unknown }).status),
          });
          await s.insert(activity).values({ label: "created task" });
          return { ok: true };
        },
      }),
    );

    const app = oke({
      name: "manual-live-app",
      gate: { policies: [gate.public] },
    }).adopt({ tasksLive, createTask });
    Object.assign(app.$options, { env: "test", stores: [db], unguardedHttp: "allow" });
    // PGLite boot (real app path) — the bridge binds on the pglite primary.
    // Passed via boot.config: the createTestApp harness defaults to memory
    // SQL unless boot.config.drivers.store.sql is set explicitly.
    await createTestApp(app, {
      boot: {
        stores: [db],
        config: { drivers: { store: { sql: { test: "pglite" } } } },
      },
    });

    // Subscribe to the manual live route and collect SSE frames.
    const res = await app.fetch(new Request("http://localhost/tasks/live?status=eq.open"));
    if (res.status !== 200) {
      console.error("live route failed:", res.status, await res.text());
    }
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();

    // Write through the two-table flow — CDC flows globally, but only the
    // tasks row (matching the ?status=eq.open window) reaches this stream.
    const post = await app.fetch(
      new Request("http://localhost/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "hello", status: "open" }),
      }),
    );
    expect(post.status).toBe(200);

    const deadline = Date.now() + 5000;
    const frames: string[] = [];
    while (Date.now() < deadline && frames.length < 2) {
      const chunk = await Promise.race([
        reader.read().then((r) => r),
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 500)),
      ]);
      if (chunk === "timeout") continue;
      if (chunk.done) break;
      frames.push(new TextDecoder().decode(chunk.value));
    }
    await reader.cancel();

    const body = frames.join("");
    expect(body).toContain("data:");
    expect(body).toContain('"kind":"upsert"');
    expect(body).toContain('"title":"hello"');
    expect(body).not.toContain("created task");
    expect(body).not.toContain('"kind":"revoked"');
  });
});
