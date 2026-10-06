/**
 * Tier-1 cache is automatic for read-only flows once effects exist
 * (inferred by extract, or declared). No `cache: "30s"` default.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { gate } from "../elements/gate.ts";
import { field, id, now, store } from "../elements/store.ts";
import { createTestApp, type TestApiCall, type TestApp } from "../test/create-test-app.ts";
import { isStoreResourceRef } from "../elements/store/cache.ts";
import type { Effects } from "../manifest/types.ts";
import { oke } from "./app.ts";
import { resetNoEffectsWarnForTests } from "./boot.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
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

const NoteOut = z.object({ id: z.string(), title: z.string() });

function requireNotesApi(t: TestApp): { list: TestApiCall; create: TestApiCall } {
  const notes = t.api.notes;
  const list = notes?.list;
  const create = notes?.create;
  if (!list || !create) throw new Error("missing notes test API");
  return { list, create };
}

describe("automatic tier-1 cache from effects", () => {
  test("read-only flow caches the second call without cache: on the flow", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    let lists = 0;
    const list = on(
      http.get("/notes", { out: z.array(NoteOut) }).public(),
      flow("notes.list", {
        effects: { reads: ["sql:notes"] },
        do: () => {
          lists += 1;
          return [{ id: "n1", title: "Harbor" }];
        },
      }),
    );
    const app = oke({
      name: "auto-cache",
      stores: [db],
      cache: { auto: true },
      gate: { policies: [gate.public] },
    }).adopt({ list });
    const t = await createTestApp(app, { capability: "open" });
    const notesApi = requireNotesApi(t);

    const first = await notesApi.list({});
    const second = await notesApi.list({});
    expect(first.data).toEqual([{ id: "n1", title: "Harbor" }]);
    expect(second.data).toEqual([{ id: "n1", title: "Harbor" }]);
    expect(lists).toBe(1);

    const runs = await t.runs();
    const caches = runs.filter((r) => r.flow === "notes.list").map((r) => r.cache);
    expect(caches).toContain("miss");
    expect(caches).toContain("hit");
    await t.close();
  });

  test("execute reports cache; revealPii trusted invoke is not a hit", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    const list = on(
      http.get("/notes", { out: z.array(NoteOut) }).public(),
      flow("notes.list", {
        effects: { reads: ["sql:notes"] },
        do: () => [{ id: "n1", title: "Harbor" }],
      }),
    );
    const app = oke({
      name: "auto-cache-execute",
      stores: [db],
      cache: { auto: true },
      gate: { policies: [gate.public] },
    }).adopt({ list });
    const t = await createTestApp(app, { capability: "open" });
    const trigger = list.triggers[0];
    if (trigger === undefined) throw new Error("notes.list has no trigger");

    const first = await app.execute(list, {}, trigger);
    const second = await app.execute(list, {}, trigger);
    expect(first.cache).toBe("miss");
    expect(second.cache).toBe("hit");

    const revealed = await app.execute(list, {}, trigger, {
      trustedInvoke: true,
      revealPii: true,
    });
    expect(revealed.cache).not.toBe("hit");
    await t.close();
  });

  test("cache: false opts out", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    let lists = 0;
    const list = on(
      http.get("/notes").public(),
      flow("notes.list", {
        cache: false,
        effects: { reads: ["sql:notes"] },
        do: () => {
          lists += 1;
          return [{ id: "n1", title: "Harbor" }];
        },
      }),
    );
    const app = oke({
      name: "auto-cache-off",
      stores: [db],
      gate: { policies: [gate.public] },
    }).adopt({ list });
    const t = await createTestApp(app, { capability: "open" });
    const notesApi = requireNotesApi(t);
    await notesApi.list({});
    await notesApi.list({});
    expect(lists).toBe(2);
    const runs = await t.runs();
    expect(runs.every((r) => r.cache === "none")).toBe(true);
    await t.close();
  });

  test("read-only flow without declared effects caches from ledgered store reads", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    let lists = 0;
    const list = on(
      http.get("/notes", { out: z.array(NoteOut) }).public(),
      flow("notes.list", {
        do: async (_input, fx) => {
          lists += 1;
          const rows = await fx.store(db).select().from(notes);
          return rows.map((row) => ({ id: String(row.id), title: String(row.title) }));
        },
      }),
    );
    const app = oke({
      name: "auto-cache-ledger",
      stores: [db],
      cache: { auto: true },
      gate: { policies: [gate.public] },
    }).adopt({ list });
    const t = await createTestApp(app, { capability: "open" });
    const notesApi = requireNotesApi(t);

    await notesApi.list({});
    await notesApi.list({});
    expect(lists).toBe(1);

    const runs = await t.runs();
    const listRuns = runs.filter((r) => r.flow === "notes.list");
    const miss = listRuns.find((r) => r.cache === "miss");
    const hit = listRuns.find((r) => r.cache === "hit");
    expect(miss).toBeDefined();
    expect(hit).toBeDefined();
    expect(miss!.id).not.toBe(hit!.id);
    expect(miss!.effects.length).toBeGreaterThanOrEqual(1);
    expect(miss!.effects.some((e) => e.kind === "read" && isStoreResourceRef(e.resource))).toBe(
      true,
    );
    expect(hit!.effects.length).toBeGreaterThanOrEqual(1);
    expect(hit!.effects.every((e) => e.resource.startsWith("computed:"))).toBe(true);
    expect(hit!.effects.every((e) => !isStoreResourceRef(e.resource))).toBe(true);
    await t.close();
  });

  test("a write invalidates the cached read", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    let lists = 0;
    const list = on(
      http.get("/notes").public(),
      flow("notes.list", {
        effects: { reads: ["sql:notes"] },
        do: () => {
          lists += 1;
          return [{ id: `n${lists}`, title: "Harbor" }];
        },
      }),
    );
    const create = on(
      http.post("/notes", { in: z.object({ title: z.string() }) }).public(),
      flow("notes.create", {
        effects: { writes: ["sql:notes"] },
        do: (input) => ({ id: "n-new", title: input.title }),
      }),
    );
    const app = oke({
      name: "auto-cache-inv",
      stores: [db],
      cache: { auto: true },
      gate: { policies: [gate.public] },
    }).adopt({ list, create });
    const t = await createTestApp(app, { capability: "open" });
    const notesApi = requireNotesApi(t);

    await notesApi.list({});
    expect(lists).toBe(1);
    await notesApi.create({ title: "New" });
    const after = await notesApi.list({});
    expect(lists).toBe(2);
    expect(after.data).toEqual([{ id: "n2", title: "Harbor" }]);
    await t.close();
  });

  test("a write without declared effects still invalidates the cached read", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    let lists = 0;
    const list = on(
      http.get("/notes", { out: z.array(NoteOut) }).public(),
      flow("notes.list", {
        do: async (_input, fx) => {
          lists += 1;
          const rows = await fx.store(db).select().from(notes);
          return rows.map((row) => ({ id: String(row.id), title: String(row.title) }));
        },
      }),
    );
    const create = on(
      http.post("/notes", { in: z.object({ title: z.string() }) }).public(),
      flow("notes.create", {
        do: async (input, fx) => {
          const id = `n-${lists + 1}`;
          await fx.store(db).insert(notes).values({ id, title: input.title });
          return { id, title: input.title };
        },
      }),
    );
    const app = oke({
      name: "auto-cache-ledger-inv",
      stores: [db],
      cache: { auto: true },
      gate: { policies: [gate.public] },
    }).adopt({ list, create });
    const t = await createTestApp(app, { capability: "open" });
    const notesApi = requireNotesApi(t);

    await notesApi.list({});
    expect(lists).toBe(1);
    await notesApi.create({ title: "New" });
    await notesApi.list({});
    expect(lists).toBe(2);
    await t.close();
  });

  test("omitted cache caches a pure store read", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    let lists = 0;
    const list = on(
      http.get("/notes").public(),
      flow("notes.list", {
        effects: { reads: ["sql:notes"] },
        do: () => {
          lists += 1;
          return [{ id: "n1", title: "Harbor" }];
        },
      }),
    );
    const app = oke({
      name: "auto-cache-default-on",
      stores: [db],
      gate: { policies: [gate.public] },
    }).adopt({ list });
    const t = await createTestApp(app, { capability: "open" });
    const notesApi = requireNotesApi(t);
    await notesApi.list({});
    await notesApi.list({});
    expect(lists).toBe(1);
    await t.close();
  });

  test("cache.auto false turns automatic caching off", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    let lists = 0;
    const list = on(
      http.get("/notes").public(),
      flow("notes.list", {
        effects: { reads: ["sql:notes"] },
        do: () => {
          lists += 1;
          return [{ id: "n1", title: "Harbor" }];
        },
      }),
    );
    const app = oke({
      name: "auto-cache-app-off",
      stores: [db],
      cache: { auto: false },
      gate: { policies: [gate.public] },
    }).adopt({ list });
    const t = await createTestApp(app, { capability: "open" });
    const notesApi = requireNotesApi(t);
    await notesApi.list({});
    await notesApi.list({});
    expect(lists).toBe(2);
    await t.close();
  });

  test("cache: true opts one flow in without the app switch", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    let lists = 0;
    const list = on(
      http.get("/notes", { out: z.array(NoteOut) }).public(),
      flow("notes.list", {
        cache: true,
        effects: { reads: ["sql:notes"] },
        do: () => {
          lists += 1;
          return [{ id: "n1", title: "Harbor" }];
        },
      }),
    );
    const app = oke({
      name: "auto-cache-flow-opt-in",
      stores: [db],
      gate: { policies: [gate.public] },
    }).adopt({ list });
    const t = await createTestApp(app, { capability: "open" });
    const notesApi = requireNotesApi(t);
    await notesApi.list({});
    await notesApi.list({});
    expect(lists).toBe(1);
    await t.close();
  });

  const sideEffects = [
    { kind: "emit", effects: { reads: ["sql:notes"], emits: ["note.created"] } },
    { kind: "send", effects: { reads: ["sql:notes"], sends: ["welcome"] } },
    { kind: "fetch", effects: { reads: ["sql:notes"], fetches: ["api.example.com"] } },
    { kind: "secret", effects: { reads: ["sql:notes"], secrets: ["stripe"] } },
    { kind: "ask", effects: { reads: ["sql:notes"], asks: ["summarize"] } },
    { kind: "decide", effects: { reads: ["sql:notes"], decides: ["route"] } },
    { kind: "call", effects: { reads: ["sql:notes"], calls: ["notes.create"] } },
  ] satisfies readonly { kind: string; effects: Effects }[];

  for (const side of sideEffects) {
    test(`${side.kind} effects run the handler on every call`, async () => {
      resetBindings();
      resetFlowSeq();
      const db = store.sql("app", { schema: { notes } });
      let lists = 0;
      const list = on(
        http.get("/notes").public(),
        flow("notes.list", {
          effects: side.effects,
          do: () => {
            lists += 1;
            return [{ id: "n1", title: "Harbor" }];
          },
        }),
      );
      const app = oke({
        name: `auto-cache-${side.kind}`,
        stores: [db],
        cache: { auto: true },
        gate: { policies: [gate.public] },
      }).adopt({ list });
      const t = await createTestApp(app, { capability: "open" });
      const notesApi = requireNotesApi(t);
      await notesApi.list({});
      await notesApi.list({});
      expect(lists).toBe(2);
      await t.close();
    });
  }

  test("a ledgered call beside a store read is not cached", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    let lists = 0;
    const list = on(
      http.get("/notes", { out: z.array(NoteOut) }).public(),
      flow("notes.list", {
        do: async (_input, fx) => {
          lists += 1;
          await fx.store(db).select().from(notes);
          await fx.call("notes.missing", {});
          return [{ id: "n1", title: "Harbor" }];
        },
      }),
    );
    const app = oke({
      name: "auto-cache-ledger-call",
      stores: [db],
      cache: { auto: true },
      gate: { policies: [gate.public] },
    }).adopt({ list });
    const t = await createTestApp(app, { capability: "open" });
    const notesApi = requireNotesApi(t);
    await notesApi.list({});
    await notesApi.list({});
    expect(lists).toBe(2);
    await t.close();
  });

  test("two tenants do not share a cache hit", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    let lists = 0;
    const list = on(
      http.get("/notes").public(),
      flow("notes.list", {
        effects: { reads: ["sql:notes"] },
        do: () => {
          lists += 1;
          return [{ id: "n1", title: "Harbor" }];
        },
      }),
    );
    const app = oke({
      name: "auto-cache-tenant",
      stores: [db],
      cache: { auto: true },
      gate: { policies: [gate.public] },
    }).adopt({ list });
    const t = await createTestApp(app, { capability: "open" });
    const trigger = list.triggers[0];
    if (trigger === undefined) throw new Error("notes.list has no trigger");
    await app.execute(list, {}, trigger, { tenant: { id: "ta" } });
    await app.execute(list, {}, trigger, { tenant: { id: "ta" } });
    expect(lists).toBe(1);
    await app.execute(list, {}, trigger, { tenant: { id: "tb" } });
    expect(lists).toBe(2);
    await t.close();
  });

  test("two locales do not share a cache hit", async () => {
    resetBindings();
    resetFlowSeq();
    const db = store.sql("app", { schema: { notes } });
    let lists = 0;
    const list = on(
      http.get("/notes").public(),
      flow("notes.list", {
        effects: { reads: ["sql:notes"] },
        do: () => {
          lists += 1;
          return [{ id: "n1", title: "Harbor" }];
        },
      }),
    );
    const app = oke({
      name: "auto-cache-locale",
      stores: [db],
      cache: { auto: true },
      config: { i18n: { locales: ["en", "ar"], default: "en" } },
      gate: { policies: [gate.public] },
    }).adopt({ list });
    const t = await createTestApp(app, { capability: "open" });
    const trigger = list.triggers[0];
    if (trigger === undefined) throw new Error("notes.list has no trigger");
    await app.execute(list, {}, trigger, { locale: "en" });
    await app.execute(list, {}, trigger, { locale: "en" });
    expect(lists).toBe(1);
    await app.execute(list, {}, trigger, { locale: "ar" });
    expect(lists).toBe(2);
    await t.close();
  });
});
