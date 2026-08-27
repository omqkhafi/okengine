/**
 * Project-wide `store.live` default — real boot.
 *
 * `oke({ store: { live: true } })` flips NEW `store.schema.table()` posts to
 * live-by-default: a resource mounted with `.all()` (no explicit `live: true`)
 * gets a real `GET <path>/live` SSE route, and `store.schema.live(false)` opts
 * a table out. The off-flag app keeps today's behavior — no live route.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { gate } from "../gate.ts";
import { oke } from "../../kernel/app.ts";
import { resetFlowSeq } from "../../kernel/flow.ts";
import { on, resetBindings } from "../../kernel/on.ts";
import { http } from "../../kernel/triggers.ts";
import { createTestApp } from "../../test/create-test-app.ts";
import { field, id, store } from "../store.ts";
import { resetPendingResourceLive } from "../../kernel/resource-live.ts";
import { z } from "zod";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
  resetPendingResourceLive();
});

const tasks = store.schema.table(
  "tasks",
  {
    id: field.text().primaryKey().defaultFn(id),
    title: field.text().notNull(),
  },
  [store.schema.policy.owner("owner")],
);

const archive = store.schema.table(
  "archive",
  {
    id: field.text().primaryKey().defaultFn(id),
    label: field.text().notNull(),
  },
  [store.schema.policy.owner("owner"), store.schema.live(false)],
);

/**
 * Mount the two CRUD resources. The `/tasks` resource's own `POST /tasks`
 * create verb is used for the live-window write.
 */
function mountResource(db: ReturnType<typeof store.sql>) {
  const tasksR = store.resource(db, tasks, {
    in: z.object({ title: z.string() }),
    out: z.object({ id: z.string(), title: z.string() }),
  });
  const archiveR = store.resource(db, archive, {
    in: z.object({ label: z.string() }),
    out: z.object({ id: z.string(), label: z.string() }),
  });
  on(http.resource("/tasks", tasksR.all()).gate(gate.public));
  on(http.resource("/archive", archiveR.all()).gate(gate.public));
}

describe("project-wide store.live default — real boot", () => {
  test("flag on: omitted live mounts GET /tasks/live; live(false) table gets no live route", async () => {
    resetBindings();
    resetFlowSeq();
    resetPendingResourceLive();

    const db = store.sql("app", { schema: { tasks, archive } });
    mountResource(db);

    const app = oke({
      name: "live-default-app",
      store: { live: true },
      gate: { policies: [gate.public] },
    });
    Object.assign(app.$options as never, {
      env: "test",
      stores: [db],
      unguardedHttp: "allow",
    });
    await createTestApp(app, {
      boot: {
        stores: [db],
        config: { drivers: { store: { sql: { test: "pglite" } } } },
      },
    });

    // The pending resource live mount drained — GET /tasks/live streams 200.
    const live = await app.fetch(new Request("http://localhost/tasks/live"));
    expect(live.status).toBe(200);
    expect(live.headers.get("content-type")).toMatch(/text\/event-stream/);
    await live.body!.cancel();

    // The archive table opted out via store.schema.live(false) — no /live route.
    const archiveLive = await app.fetch(new Request("http://localhost/archive/live"));
    expect(archiveLive.status).not.toBe(200);
  });

  test("flag off: omitted live stays today's behavior — no /live route", async () => {
    resetBindings();
    resetFlowSeq();
    resetPendingResourceLive();

    const db = store.sql("app", { schema: { tasks, archive } });
    mountResource(db);

    const app = oke({
      name: "live-off-app",
      gate: { policies: [gate.public] },
    });
    Object.assign(app.$options as never, {
      env: "test",
      stores: [db],
      unguardedHttp: "allow",
    });
    await createTestApp(app, {
      boot: {
        stores: [db],
        config: { drivers: { store: { sql: { test: "pglite" } } } },
      },
    });

    const live = await app.fetch(new Request("http://localhost/tasks/live"));
    expect(live.status).not.toBe(200);
    const archiveLive = await app.fetch(new Request("http://localhost/archive/live"));
    expect(archiveLive.status).not.toBe(200);
  });
});
