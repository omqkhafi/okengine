import { describe, expect, test } from "bun:test";

import { deepMatch, extractFromSources, extractManifest } from "./extract.ts";
import { emitManifest, manifestPathIn } from "./emit.ts";
import { serializeManifest } from "../manifest/validate.ts";
import type { Manifest } from "../manifest/types.ts";

const skyportRoot = new URL("./fixtures/skyport/", import.meta.url).pathname;
const goldenUrl = new URL("./fixtures/skyport.expected.json", import.meta.url);
const excerptUrl = new URL("../manifest/fixtures/skyport.excerpt.json", import.meta.url);

async function loadSkyportFiles(): Promise<{ path: string; source: string }[]> {
  const glob = new Bun.Glob("**/*.{ts,tsx}");
  const files: { path: string; source: string }[] = [];
  for await (const path of glob.scan({ cwd: skyportRoot, onlyFiles: true })) {
    files.push({
      path,
      source: await Bun.file(`${skyportRoot}${path}`).text(),
    });
  }
  return files;
}

describe("extractManifest — Skyport", () => {
  test("golden-file comparison against committed expected manifest", async () => {
    const files = await loadSkyportFiles();
    const manifest = await extractManifest({ files });
    const expected = JSON.parse(await Bun.file(goldenUrl).text()) as Manifest;

    expect(manifest).toEqual(expected);

    // Also matches the spec excerpt (subset).
    const excerpt = JSON.parse(await Bun.file(excerptUrl).text()) as Manifest;
    expect(deepMatch(manifest, excerpt)).toBe(true);
  });

  test("emitManifest writes manifest.oke.json", async () => {
    const files = await loadSkyportFiles();
    const manifest = await extractManifest({ files });
    const dir = `${skyportRoot}.out`;
    await Bun.$`mkdir -p ${dir}`;
    const path = await emitManifest({
      path: manifestPathIn(dir),
      manifest,
    });
    const written = JSON.parse(await Bun.file(path).text()) as Manifest;
    expect(written.app).toBe("skyport");
    expect(written.oke).toBe("1.0");
    await Bun.$`rm -rf ${dir}`;
  });
});

describe("extractManifest — five trigger types", () => {
  test("effects inferred for http · every · signal · cdc · internal", async () => {
    const source = await Bun.file(
      new URL("./fixtures/triggers/five-triggers.ts", import.meta.url),
    ).text();
    const manifest = await extractFromSources({
      "src/flows/triggers.ts": source,
    });

    expect(manifest.flows?.["triggers.http"]?.trigger).toEqual({
      http: { method: "POST", path: "/orders" },
    });
    expect(manifest.flows?.["triggers.http"]?.effects?.writes).toEqual(["sql:orders"]);

    expect(manifest.flows?.["triggers.every"]?.trigger).toEqual({
      every: "10m",
    });
    expect(manifest.flows?.["triggers.every"]?.effects?.writes).toEqual(["sql:links"]);

    expect(manifest.flows?.["triggers.signal"]?.trigger).toEqual({
      signal: "link-clicked",
    });
    expect(manifest.flows?.["triggers.signal"]?.effects?.writes).toContain("sql:links");
    expect(manifest.flows?.["triggers.signal"]?.effects?.emits).toContain("link-clicked");

    expect(manifest.flows?.["triggers.cdc"]?.trigger).toEqual({
      cdc: { table: "orders", column: "status" },
    });
    expect(manifest.flows?.["triggers.cdc"]?.effects?.writes).toEqual(["sql:orders"]);

    // internal trigger → no trigger key (call-only), or empty trigger object
    const internal = manifest.flows?.["triggers.internal"];
    expect(internal?.trigger === undefined || Object.keys(internal.trigger).length === 0).toBe(
      true,
    );
    expect(internal?.effects?.reads).toEqual(["sql:links"]);
  });
});

describe("extractManifest — fx.raw", () => {
  test("unannotated fx.raw is cache-ineligible; annotated is not", async () => {
    const source = await Bun.file(
      new URL("./fixtures/raw/raw-unannotated.ts", import.meta.url),
    ).text();
    const manifest = await extractFromSources({
      "src/flows/raw.ts": source,
    });

    expect(manifest.flows?.["raw.unannotated"]?.cache).toBe(false);
    expect(manifest.flows?.["raw.annotated"]?.cache).toBeUndefined();
    expect(manifest.flows?.["raw.annotated"]?.effects?.reads).toEqual(["sql:orders"]);
  });
});

describe("extractManifest — performance", () => {
  test("200-flow synthetic app extracts in under 2s", async () => {
    const sources: Record<string, string> = {};
    const parts: string[] = [
      `import { on, flow, http, store } from "okengine";`,
      `export const db = store.sql("db");`,
      `export const items = { name: "items" };`,
      `export const app = { name: "synth" };`,
    ];
    // Declare oke name via a tiny app file pattern
    sources["src/app.ts"] = `
      import { oke } from "okengine";
      export const app = oke({ name: "synth200" });
    `;

    for (let i = 0; i < 200; i++) {
      parts.push(`
export const flow_${i} = on(
  http.get("/f/${i}"),
  flow({
    name: "synth.flow_${i}",
    do: async (input, fx) => {
      await fx.store(db).insert(items).values(input);
      const rows = await fx.store(db).select().from(items);
      return { n: rows.length, i: ${i} };
    },
  }),
);
`);
    }
    sources["src/flows/all.ts"] = parts.join("\n");

    const start = performance.now();
    const manifest = await extractFromSources(sources);
    const elapsed = performance.now() - start;

    expect(Object.keys(manifest.flows ?? {}).length).toBe(200);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("serializeManifest stability", () => {
  test("extracted Skyport round-trips through JSON", async () => {
    const files = await loadSkyportFiles();
    const manifest = await extractManifest({ files });
    const text = serializeManifest(manifest);
    const again = JSON.parse(text) as Manifest;
    expect(again).toEqual(manifest);
  });
});

describe("extractManifest — relational with: is never expanded (path b)", () => {
  test("findMany({ with: { daily: true } }) records no related-table effects", async () => {
    const source = `
import { on, flow, http, store } from "okengine";

export const db = store.sql("db");
export const links = { name: "links" };
export const daily = { name: "daily" };

export const listLinks = on(
  http.get("/links"),
  flow({
    name: "rel.root",
    do: async (_input, fx) => {
      return fx.store(db).select().from(links);
    },
  }),
);

// Hypothetical RQB-shaped call. inferEffects never consults schema
// relations, so the related table must NOT appear in effects.
export const withDaily = on(
  http.get("/links/with-daily"),
  flow({
    name: "rel.with",
    do: async (_input, fx) => {
      return fx.store(db).findMany({ with: { daily: true } });
    },
  }),
);
`;
    const manifest = await extractFromSources({ "src/flows/rel.ts": source });

    // Root-table read stays exact.
    expect(manifest.flows?.["rel.root"]?.effects?.reads).toEqual(["sql:links"]);

    // The with: argument is not walked — falls back to the store-level
    // resource, never the relation target.
    expect(manifest.flows?.["rel.with"]?.effects?.reads).toEqual(["sql:db"]);

    const allEffects = Object.values(manifest.flows ?? {}).flatMap((f) => [
      ...(f.effects?.reads ?? []),
      ...(f.effects?.writes ?? []),
    ]);
    expect(allEffects).not.toContain("sql:daily");
  });
});

describe("extractManifest — store.schema.table", () => {
  test("extracts DeclaredColumn with PII into manifest stores", async () => {
    const source = `
import { store, field, id, now } from "okengine";

export const notes = store.schema.table("notes", {
  id: field.text().primaryKey().defaultFn(id),
  title: field.text().notNull(),
  body: field.text().notNull().pii(),
  createdAt: field.integer().notNull().defaultFn(now),
});

export const db = store.sql("app", { schema: { notes } });
`;
    const manifest = await extractFromSources({
      "src/schema.decl.ts": source,
    });

    expect(manifest.stores?.app?.facet).toBe("sql");
    const cols = manifest.stores?.app?.tables?.notes?.columns;
    expect(cols?.body).toMatchObject({
      type: "text",
      pii: true,
      nullable: false,
      sqlName: "body",
    });
    expect(cols?.createdAt).toMatchObject({
      type: "integer",
      sqlName: "created_at",
      nullable: false,
    });
    expect(cols?.id).toMatchObject({
      type: "text",
      primaryKey: true,
      sqlName: "id",
    });
  });

  test("extracts optional description fields additively", async () => {
    const source = `
import { store, field, signal, channel, clock, gate, vault } from "okengine";

export const notes = store.schema.table("notes", {
  title: field.text().notNull().describe("Note title"),
});

export const db = store.sql("app", {
  description: "Primary app database",
  schema: { notes },
});

export const embeddings = store.index("embeddings", {
  description: "Document embeddings",
  dims: 3,
});

export const sessions = store.kv("sessions", { description: "Session cache" });

export const orderPlaced = signal("order-placed", {
  delivery: "once",
  description: "Order placed event",
});

export const bookingConfirmed = channel.template("booking-confirmed", {
  medium: "email",
  description: "Booking confirmation email",
});

export const expireHolds = clock("expire-holds", {
  every: "10m",
  description: "Expire unpaid holds",
});

export const member = gate.policy("member", {
  description: "Verified members only",
  check: ({ auth }) => !!auth?.verified,
});

export const stripeKey = vault.secret("STRIPE_KEY", {
  description: "Payments gateway key",
});
`;
    const manifest = await extractFromSources({
      "src/described.ts": source,
    });

    expect(manifest.stores?.app?.description).toBe("Primary app database");
    expect(manifest.stores?.app?.tables?.notes?.columns?.title).toMatchObject({
      description: "Note title",
    });
    expect(manifest.stores?.embeddings?.description).toBe("Document embeddings");
    expect(manifest.stores?.sessions?.description).toBe("Session cache");
    expect(manifest.signals?.["order-placed"]?.description).toBe("Order placed event");
    expect(manifest.channels?.["booking-confirmed"]?.description).toBe(
      "Booking confirmation email",
    );
    expect(manifest.clocks?.["expire-holds"]?.description).toBe("Expire unpaid holds");
    expect(manifest.gates?.member?.description).toBe("Verified members only");
    expect(manifest.vault?.STRIPE_KEY?.description).toBe("Payments gateway key");
  });
});

describe("extractManifest — on(http.resource(...))", () => {
  test("expands the mount into five CRUD bindings with store effects", async () => {
    const source = `
import { on, http, store } from "okengine";

export const db = store.sql("notes", { schema: {} });

const notesR = store.resource(db, {}, { unit: "notes", breaking: true });

const mounted = on(http.resource("/notes", notesR.all()));

export const list = mounted.list;
export const create = mounted.create;
export const get = mounted.get;
export const update = mounted.update;
export const remove = mounted.remove;
`;
    const manifest = await extractFromSources({ "src/flows/notes.ts": source });

    expect(manifest.flows?.list?.trigger).toEqual({
      http: { method: "GET", path: "/notes" },
    });
    expect(manifest.flows?.create?.trigger).toEqual({
      http: { method: "POST", path: "/notes" },
    });
    expect(manifest.flows?.get?.trigger).toEqual({
      http: { method: "GET", path: "/notes/:id" },
    });
    expect(manifest.flows?.update?.trigger).toEqual({
      http: { method: "PATCH", path: "/notes/:id" },
    });
    expect(manifest.flows?.remove?.trigger).toEqual({
      http: { method: "DELETE", path: "/notes/:id" },
    });
    expect(manifest.flows?.list?.effects?.reads).toEqual(["sql:notes"]);
    expect(manifest.flows?.create?.effects?.writes).toEqual(["sql:notes"]);
    expect(manifest.flows?.list?.breaking).toBe(true);
  });
});
