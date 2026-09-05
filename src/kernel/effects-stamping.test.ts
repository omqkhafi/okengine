/**
 * Boot-level proof: compiled/inferred effects reaching a REAL running app's
 * capability token — not an isolated compiler-only or kernel-only test.
 *
 * Before this file existed, `flow(name, {...})` with no hand-declared `effects`
 * always minted an OPEN capability token (every access allowed, no gate at
 * all) in every environment, including `docker` / `prod` — `extractManifest`
 * inference only ever fed the static `manifest.oke.json` artifact (Console,
 * docs, publish), never the live boot path. Confirmed via real `oke()` boot
 * + `app.fetch()`, not assumption.
 *
 * Also documents the sql:<table> (compiler inference) vs sql:<store-name>
 * (kernel `gatedSqlHandle`) naming mismatch this stamping bridge surfaces:
 * once inference actually reaches the runtime, a flow relying on it for a
 * real `fx.store(db).insert(table)` write must not throw `UNDECLARED_WRITE`
 * for touching the exact table it declared.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { gate } from "../elements/gate.ts";
import { field, id, now, store } from "../elements/store.ts";
import { passkey } from "../plugins/passkey.ts";
import { oke } from "./app.ts";
import { resetNoEffectsWarnForTests } from "./boot.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { createTestApp } from "../test/create-test-app.ts";
import { http } from "./triggers.ts";

afterEach(() => {
  resetBindings();
  resetFlowSeq();
  resetNoEffectsWarnForTests();
});

const notes = store.schema.table("notes", {
  id: field.text().primaryKey().defaultFn(id),
  title: field.text().notNull(),
  createdAt: field.integer().notNull().defaultFn(now),
});

const CreateIn = z.object({ id: z.string(), title: z.string() });
const CreateOut = z.object({ ok: z.boolean() });

function buildUnannotatedCreateFlow(db: ReturnType<typeof store.sql>) {
  return on(
    http.post("/notes").public(),
    flow("notes.create", {
      in: CreateIn,
      out: CreateOut,
      // Deliberately no `effects` — the "let the compiler infer it" case.
      do: async (input, fx) => {
        await fx.store(db).insert(notes).values({ id: input.id, title: input.title, createdAt: 1 });
        return { ok: true };
      },
    }),
  );
}

describe("boot-level: undeclared-effects flow, no manifest / rootDir", () => {
  test("local / test: open token — real insert succeeds (documented dev-loop fallback)", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    // `on(...)` (inside buildUnannotatedCreateFlow) must run BEFORE `oke(...)`
    // is constructed — oke() synchronously drains the global on() registry
    // at construction time; a binding created only as .adopt()'s argument
    // (after oke() already ran) never gets wired to a route.
    const create = buildUnannotatedCreateFlow(db);
    const app = oke({ name: "stamp-open", gate: { policies: [gate.public] } }).adopt({ create });
    Object.assign(app.$options, { stores: [db] });
    await createTestApp(app); // createTestApp always boots env: "test"

    const res = await app.fetch(
      new Request("http://localhost/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "x1", title: "hi" }),
      }),
    );
    expect(res.status).toBe(200);
  });

  test("docker: hard fail at boot — OKE1008, never an open token in a deploy-shaped env", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    const create = buildUnannotatedCreateFlow(db);
    const app = oke({ name: "stamp-docker", gate: { policies: [gate.public] } }).adopt({ create });

    const memoryDrivers = {
      store: {
        sql: { dev: "memory", prod: "memory" },
        kv: { dev: "memory", prod: "memory" },
      },
      channel: { email: { dev: "console", prod: "console" } },
    } as const;
    await expect(
      app.boot({
        env: "dev",
        docker: true,
        stores: [db],
        unguardedHttp: "allow",
        startScheduler: false,
        config: { drivers: memoryDrivers },
      }),
    ).rejects.toThrow(/OKE1008/);
  });

  test("prod: hard fail at boot — same posture as docker", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    const create = buildUnannotatedCreateFlow(db);
    const app = oke({ name: "stamp-prod", gate: { policies: [gate.public] } }).adopt({ create });

    await expect(
      app.boot({
        env: "prod",
        stores: [db],
        unguardedHttp: "allow",
        startScheduler: false,
        config: {
          drivers: {
            store: { sql: { prod: "memory" }, kv: { prod: "memory" } },
            channel: { email: { prod: "console" } },
          },
        },
      }),
    ).rejects.toThrow(/OKE1008/);
  });
});

describe("boot-level: table-ref resolution stays backward compatible", () => {
  test("older store-level effects (sql:<store>) still cover a schema-table op — every existing template's convention", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    const create = on(
      http.post("/notes").public(),
      flow("notes.create", {
        in: CreateIn,
        out: CreateOut,
        // The convention every template/test predates Direction B with —
        // store-level, not table-level. Must keep working unchanged.
        effects: { writes: ["sql:app"] },
        do: async (input, fx) => {
          await fx
            .store(db)
            .insert(notes)
            .values({ id: input.id, title: input.title, createdAt: 1 });
          return { ok: true };
        },
      }),
    );
    const app = oke({ name: "stamp-back-compat", gate: { policies: [gate.public] } }).adopt({
      create,
    });
    Object.assign(app.$options, { stores: [db] });
    await createTestApp(app);

    const res = await app.fetch(
      new Request("http://localhost/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "x1", title: "hi" }),
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("boot-level: undeclared-effects flow, rootDir stamping from a real source tree", () => {
  test("real fx.store(db).insert(table) write succeeds once inference is stamped onto the capability token", async () => {
    resetBindings();
    resetFlowSeq();
    const dir = await mkdtemp(join(tmpdir(), "oke-stamp-"));
    try {
      await mkdir(join(dir, "flows", "notes"), { recursive: true });
      // A real source file with NO manual `effects:` — extractManifest infers
      // `writes: ["sql:notes"]` for this from the real `fx.store(db).insert`
      // call, exactly like the kernel test flow above.
      await writeFile(
        join(dir, "flows", "notes", "index.ts"),
        `
import { on, flow, http, gate } from "okengine";
// Unresolved bindings are fine — extraction is AST-only, never executed.
// What matters is the literal shape: fx.store(db).insert(notes) so the
// same table-name inference that produced "sql:notes" earlier fires here.
const db = {} as any;
const notes = {} as any;
export const create = on(
  http.post("/notes").public(),
  flow("notes.create", {
    do: async (input, fx) => {
      await fx.store(db).insert(notes).values({ id: input.id, title: input.title, createdAt: 1 });
      return { ok: true };
    },
  }),
);
`,
      );

      const db = store.sql("app", { schema: { notes } });
      const create = buildUnannotatedCreateFlow(db);
      const app = oke({ name: "stamp-rootdir", gate: { policies: [gate.public] } }).adopt({
        create,
      });
      Object.assign(app.$options, { stores: [db] });
      await createTestApp(app, { boot: { rootDir: dir } });

      const res = await app.fetch(
        new Request("http://localhost/notes", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: "x1", title: "hi" }),
        }),
      );
      const body = (await res.json()) as { data: unknown; error: { message?: string } | null };
      expect(res.status, body.error?.message ?? "").toBe(200);
      expect(body.data).toEqual({ ok: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("boot-level: built-in auth flows under docker", () => {
  test("emailAndPassword + passkey boot with docker:true — empty stamp from Manifest, no hand-declared effects", async () => {
    resetBindings();
    resetFlowSeq();
    const memoryDrivers = {
      store: {
        sql: { dev: "memory", prod: "memory" },
        kv: { dev: "memory", prod: "memory" },
      },
      channel: { email: { dev: "console", prod: "console" } },
    } as const;
    const app = oke({
      name: "auth-stamp-docker",
      registry: "ignore",
      gate: {
        auth: {
          secret: "test-secret-at-least-16",
          emailAndPassword: { enabled: true },
        },
      },
    }).plug(passkey({ origins: ["http://localhost"] }));

    // Explicit Manifest (as `oke dev` extract would supply for app Flows).
    // Framework auth Flows are absent → mintCapabilities stamps `{}`.
    await app.boot({
      env: "dev",
      docker: true,
      unguardedHttp: "allow",
      startScheduler: false,
      manifest: { oke: "1.0", app: "auth-stamp-docker", flows: {} },
      config: { drivers: memoryDrivers },
    });
    await app.stop();
  });
});
