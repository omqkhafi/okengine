/**
 * Effect inference follows `fx` into helpers and same-function chain aliases.
 */

import { describe, expect, test } from "bun:test";
import { extractFromSources } from "./extract.ts";

const header = `
import { on, flow, http, store } from "okengine";
export const db = store.sql("app");
export const notes = store.schema.table("notes", { id: field.text().primaryKey() });
`;

describe("extractManifest — fx helpers and chain aliases", () => {
  test("a same-file helper's store read is part of the flow", async () => {
    const manifest = await extractFromSources({
      "src/flows/notes/get.ts": `
${header}
async function load(fx: Fx) {
  await fx.store(db).select().from(notes);
}
export const get = on(http.get("/notes"), flow("notes.get", {
  do: async (_input, fx) => {
    await load(fx);
    return { ok: true };
  },
}));
`,
    });
    expect(manifest.flows?.["notes.get"]?.effects?.reads).toEqual(["sql:notes"]);
  });

  test("an imported helper's store read is part of the flow", async () => {
    const manifest = await extractFromSources({
      "src/flows/notes/_shared.ts": `
${header}
export async function load(fx: Fx) {
  await fx.store(db).select().from(notes);
}
`,
      "src/flows/notes/get.ts": `
import { on, flow, http } from "okengine";
import { load } from "./_shared";
export const get = on(http.get("/notes"), flow("notes.get", {
  do: async (_input, fx) => load(fx),
}));
`,
    });
    expect(manifest.flows?.["notes.get"]?.effects?.reads).toEqual(["sql:notes"]);
  });

  test("a same-function chain alias records the read", async () => {
    const manifest = await extractFromSources({
      "src/flows/notes/get.ts": `
${header}
export const get = on(http.get("/notes"), flow("notes.get", {
  do: async (_input, fx) => {
    const q = fx.store(db);
    const rows = await q.select().from(notes);
    return rows;
  },
}));
`,
    });
    expect(manifest.flows?.["notes.get"]?.effects?.reads).toEqual(["sql:notes"]);
  });

  test("an as-cast store alias records the index write", async () => {
    const manifest = await extractFromSources({
      "src/flows/search/index.ts": `
import { on, flow, http, store } from "okengine";
export const taskIndex = store.index("tasks");
export const sync = on(http.post("/sync"), flow("search.sync", {
  do: async (_input, fx) => {
    const idx = fx.store(taskIndex) as {
      driverId: string;
      upsert: (id: string, doc: unknown) => Promise<void>;
    };
    if (idx.driverId === "meilisearch") {
      await idx.upsert("1", { id: "1" });
    }
  },
}));
`,
    });
    expect(manifest.flows?.["search.sync"]?.effects?.writes).toEqual(["index:tasks"]);
  });

  test("a chain alias that escapes fails extract", async () => {
    const bodies = [
      `const q = fx.store(db); return q;`,
      `const q = fx.store(db); await other(q);`,
      `let q = fx.store(db); q = fx.store(db);`,
      `const q = fx.store(db); const bag = { q }; return bag;`,
      `const q = fx.store(db); const bag = [q]; return bag;`,
    ];
    for (const body of bodies) {
      await expect(
        extractFromSources({
          "src/flows/notes/get.ts": `
${header}
export const get = on(http.get("/notes"), flow("notes.get", {
  do: async (_input, fx) => {
    ${body}
  },
}));
`,
        }),
      ).rejects.toThrow(/OKE1900/);
    }
  });

  test("renaming or destructuring fx fails extract", async () => {
    const bodies = [
      `do: async (input, ctx) => ({ ok: true })`,
      `do: async (_input, fx) => { const ctx = fx; return ctx.id(); }`,
      `do: async (_input, fx) => { const { store } = fx; return store; }`,
    ];
    for (const body of bodies) {
      await expect(
        extractFromSources({
          "src/flows/notes/get.ts": `
${header}
export const get = on(http.get("/notes"), flow("notes.get", { ${body} }));
`,
        }),
      ).rejects.toThrow(/OKE1900/);
    }
  });

  test("an effects block must cover inferred reads and may add keys", async () => {
    await expect(
      extractFromSources({
        "src/flows/notes/get.ts": `
${header}
async function load(fx: Fx) {
  await fx.store(db).select().from(notes);
}
export const get = on(http.get("/notes"), flow("notes.get", {
  effects: { reads: ["sql:other"] },
  do: async (_input, fx) => load(fx),
}));
`,
      }),
    ).rejects.toThrow(/OKE1900/);

    const manifest = await extractFromSources({
      "src/flows/notes/get.ts": `
${header}
async function load(fx: Fx) {
  await fx.store(db).select().from(notes);
}
export const get = on(http.get("/notes"), flow("notes.get", {
  effects: { reads: ["sql:notes"], writes: ["kv:extra"] },
  do: async (_input, fx) => load(fx),
}));
`,
    });
    expect(manifest.flows?.["notes.get"]?.effects).toMatchObject({
      reads: ["sql:notes"],
      writes: ["kv:extra"],
    });
  });
});
