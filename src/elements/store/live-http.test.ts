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

/** Minimal stream reader — avoids DOM `ReadableStreamReadResult` / `readMany` lib skew. */
type SseByteReader = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
};

/**
 * Drain SSE until a classified upsert frame appears, without dropping a
 * late chunk via Promise.race (a timed-out `read()` must stay the pending
 * one across loop iterations).
 */
async function readUntilUpsert(reader: SseByteReader, timeoutMs: number): Promise<string> {
  const dec = new TextDecoder();
  let body = "";
  const deadline = Date.now() + timeoutMs;
  let pending: Promise<{ done: boolean; value?: Uint8Array }> | undefined;
  while (Date.now() < deadline && !body.includes('"kind":"upsert"')) {
    pending ??= reader.read();
    const remaining = Math.max(1, deadline - Date.now());
    const step = await Promise.race([
      pending.then((r) => ({ kind: "read" as const, r })),
      new Promise<{ kind: "timeout" }>((resolve) =>
        setTimeout(() => resolve({ kind: "timeout" }), Math.min(500, remaining)),
      ),
    ]);
    if (step.kind === "timeout") continue;
    pending = undefined;
    if (step.r.done) break;
    if (step.r.value) body += dec.decode(step.r.value, { stream: true });
  }
  return body;
}

describe("manual live flow (.live(table) + liveQuery) — real boot", () => {
  // PGLite boot + CDC fan-out needs headroom over Bun's default 5s; one
  // tasks insert yields a single classified upsert frame.
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
    try {
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

      const body = await readUntilUpsert(reader, 10_000);
      await reader.cancel().catch(() => undefined);

      expect(body).toContain("data:");
      expect(body).toContain('"kind":"upsert"');
      expect(body).toContain('"title":"hello"');
      expect(body).not.toContain("created task");
      expect(body).not.toContain('"kind":"revoked"');
    } finally {
      await app.stop();
    }
  }, 15_000);
});
