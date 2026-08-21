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
  flow("synth.flow_${i}", {
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

    await extractFromSources(sources);
    const start = performance.now();
    const manifest = await extractFromSources(sources);
    const elapsed = performance.now() - start;

    expect(Object.keys(manifest.flows ?? {}).length).toBe(200);
    // Local ~400ms after warmup. GHA shared runners measured ~2.9s cold.
    const budgetMs = process.env.CI ? 4_000 : 2_000;
    expect(elapsed).toBeLessThan(budgetMs);
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
  flow("rel.root", {
    do: async (_input, fx) => {
      return fx.store(db).select().from(links);
    },
  }),
);

// Hypothetical RQB-shaped call. inferEffects never consults schema
// relations, so the related table must NOT appear in effects.
export const withDaily = on(
  http.get("/links/with-daily"),
  flow("rel.with", {
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

  test("extracts RLS helpers onto store.tables", async () => {
    const source = `
import { store, field } from "okengine";

export const bookings = store.schema.table("bookings", {
  id: field.text().primaryKey(),
  owner: field.text().notNull(),
}, [
  store.schema.policy.gate("member", { for: "select" }),
  store.schema.policy.owner("owner"),
]);

export const db = store.sql("app", { schema: { bookings } });
`;
    const manifest = await extractFromSources({
      "src/schema.decl.ts": source,
    });
    const table = manifest.stores?.app?.tables?.bookings;
    expect(table?.rls).toBe(true);
    expect(table?.policies?.gate_member_select).toMatchObject({
      for: "select",
      using: "oke.gate() = 'member'",
    });
    expect(table?.policies?.owner_owner_all?.using).toContain("oke.user()");
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
    expect(manifest.stores?.sessions?.namespaces).toEqual(["sessions"]);
    expect(manifest.stores?.sessions?.durable).toBeUndefined();
    expect(manifest.signals?.["order-placed"]?.description).toBe("Order placed event");
    expect(manifest.channels?.["booking-confirmed"]?.description).toBe(
      "Booking confirmation email",
    );
    expect(manifest.clocks?.["expire-holds"]?.description).toBe("Expire unpaid holds");
    expect(manifest.gates?.member?.description).toBe("Verified members only");
    expect(manifest.vault?.STRIPE_KEY?.description).toBe("Payments gateway key");
  });

  test("extracts store.kv durable onto the Manifest store", async () => {
    const manifest = await extractFromSources({
      "src/kv.ts": `
import { store } from "okengine";
export const sessions = store.kv("sessions", { description: "Session cache" });
export const ledger = store.kv("ledger", { durable: true, description: "Idempotency keys" });
`,
    });
    expect(manifest.stores?.sessions?.durable).toBeUndefined();
    expect(manifest.stores?.ledger?.durable).toBe(true);
    expect(manifest.stores?.ledger?.namespaces).toEqual(["ledger"]);
  });
});

describe("extractManifest — bindNamedTableCrud(...)", () => {
  test("expands the helper into unit-prefixed CRUD flows with table effects", async () => {
    const source = `
import { store } from "okengine";

export const cycles = store.schema.table("cycles", {});

export const { list, create, get, update, remove } = bindNamedTableCrud({
  unit: "cycles",
  path: "/cycles",
  table: cycles,
  liveList: true,
});
`;
    const helper = `
export function bindNamedTableCrud(spec) {
  const unit = spec.unit;
  const list = on(http.get("/x"), flow(\`\${unit}.list\`, { do: () => ({}) }));
}
`;
    const manifest = await extractFromSources({
      "src/lib/resource.ts": helper,
      "src/flows/cycles/index.ts": source,
    });

    expect(manifest.flows?.["cycles.list"]?.trigger).toEqual({
      http: { method: "GET", path: "/cycles" },
    });
    expect(manifest.flows?.["cycles.list"]?.live).toBe(true);
    expect(manifest.flows?.["cycles.create"]?.trigger).toEqual({
      http: { method: "POST", path: "/cycles" },
    });
    expect(manifest.flows?.["cycles.get"]?.trigger).toEqual({
      http: { method: "GET", path: "/cycles/:id" },
    });
    expect(manifest.flows?.["cycles.update"]?.trigger).toEqual({
      http: { method: "PATCH", path: "/cycles/:id" },
    });
    expect(manifest.flows?.["cycles.delete"]?.trigger).toEqual({
      http: { method: "DELETE", path: "/cycles/:id" },
    });
    expect(manifest.flows?.["cycles.list"]?.effects?.reads).toEqual(["sql:cycles"]);
    expect(manifest.flows?.["cycles.create"]?.effects?.writes).toEqual(["sql:cycles"]);
    expect(manifest.flows?.list).toBeUndefined();
  });

  test("expands bindCrud the same as bindNamedTableCrud", async () => {
    const source = `
import { store } from "okengine";

export const documents = store.schema.table("documents", {});

export const { list, get, update, remove } = bindCrud({
  unit: "documents",
  path: "/documents",
  table: documents,
});
`;
    const helper = `
export function bindCrud(spec) {
  const unit = spec.unit;
  const list = on(http.get("/x"), flow(\`\${unit}.list\`, { do: () => ({}) }));
}
`;
    const manifest = await extractFromSources({
      "src/lib/resource.ts": helper,
      "src/flows/documents/index.ts": source,
    });

    expect(manifest.flows?.["documents.list"]?.effects?.reads).toEqual(["sql:documents"]);
    expect(manifest.flows?.["documents.get"]?.effects?.reads).toEqual(["sql:documents"]);
    expect(manifest.flows?.["documents.update"]?.effects).toEqual({
      reads: ["sql:documents"],
      writes: ["sql:documents"],
    });
    expect(manifest.flows?.list).toBeUndefined();
  });
});

describe("extractManifest — on(http.resource(...))", () => {
  test("expands the mount into five CRUD bindings with store effects", async () => {
    const source = `
import { on, http, store } from "okengine";

export const db = store.sql("notes", { schema: {} });

const notesR = store.resource(db, {}, { breaking: true });

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

  test("chains .gate(...) and .live() onto the five verbs", async () => {
    const source = `
import { on, http, store, gate } from "okengine";

export const member = gate.policy("member", ({ auth }) => !!auth.verified);
export const db = store.sql("notes", { schema: {} });

const notesR = store.resource(db, {}, {});

const mounted = on(http.resource("/notes", notesR.all()).gate(member).live());

export const list = mounted.list;
export const create = mounted.create;
export const get = mounted.get;
export const update = mounted.update;
export const remove = mounted.remove;
`;
    const manifest = await extractFromSources({ "src/flows/notes.ts": source });

    expect(manifest.flows?.list?.gates).toEqual(["member"]);
    expect(manifest.flows?.create?.gates).toEqual(["member"]);
    expect(manifest.flows?.get?.gates).toEqual(["member"]);
    expect(manifest.flows?.update?.gates).toEqual(["member"]);
    expect(manifest.flows?.remove?.gates).toEqual(["member"]);
    expect(manifest.flows?.list?.live).toBe(true);
    expect(manifest.flows?.get?.live).toBe(true);
    expect(manifest.flows?.create?.live).toBeUndefined();
    expect(manifest.flows?.update?.live).toBeUndefined();
    expect(manifest.flows?.remove?.live).toBeUndefined();
  });

  test("chains .public().live() onto the five verbs", async () => {
    const source = `
import { on, http, store } from "okengine";

export const db = store.sql("notes", { schema: {} });
const notesR = store.resource(db, {}, {});
const mounted = on(http.resource("/notes", notesR.all()).public().live());

export const list = mounted.list;
export const create = mounted.create;
export const get = mounted.get;
export const update = mounted.update;
export const remove = mounted.remove;
`;
    const manifest = await extractFromSources({ "src/flows/notes.ts": source });
    expect(manifest.flows?.list?.gates).toEqual(["public"]);
    expect(manifest.flows?.create?.gates).toEqual(["public"]);
    expect(manifest.flows?.get?.live).toBe(true);
    expect(manifest.flows?.create?.live).toBeUndefined();
  });
});

describe("extractManifest — vault.config", () => {
  test("fx.vault.get(config) infers the contract name, not the binding id", async () => {
    const core = `
export const publicAppUrl = vault.config("PUBLIC_APP_URL", {
  description: "Public origin",
  dev: "http://127.0.0.1:6530",
});
`;
    const source = `
import { publicAppUrl } from "@/core";

export const list = on(
  http.get("/issues").gate(member),
  flow("issues.list", {
    do: async (_input, fx) => {
      await fx.vault.get(publicAppUrl);
      return { items: [] };
    },
  }),
);
`;
    const manifest = await extractFromSources({
      "src/core.ts": core,
      "src/flows/issues/index.ts": source,
    });

    expect(manifest.vault?.PUBLIC_APP_URL).toMatchObject({
      description: "Public origin",
      sensitive: false,
    });
    expect(manifest.flows?.["issues.list"]?.effects?.secrets).toEqual(["PUBLIC_APP_URL"]);
  });
});

describe("extractManifest — files-store write methods", () => {
  test("fx.store(files).put(...) infers a write, unannotated", async () => {
    const source = `
import { on, flow, http, gate, store } from "okengine";

export const files = store.files("uploads");

export const attach = on(
  http.post("/attach").public(),
  flow("notes.attach", {
    do: async (input, fx) => {
      await fx.store(files).put("key", input.text);
      return { ok: true };
    },
  }),
);
`;
    const manifest = await extractFromSources({ "src/flows/attach.ts": source });

    expect(manifest.flows?.["notes.attach"]?.effects?.writes).toEqual(["files:uploads"]);
  });

  test("fx.store(files).putImage(...) infers a write, unannotated", async () => {
    const source = `
import { on, flow, http, gate, store } from "okengine";

export const files = store.files("uploads");

export const attach = on(
  http.post("/attach").public(),
  flow("notes.attachImage", {
    do: async (input, fx) => {
      await fx.store(files).putImage("key", input.bytes);
      return { ok: true };
    },
  }),
);
`;
    const manifest = await extractFromSources({ "src/flows/attach.ts": source });

    expect(manifest.flows?.["notes.attachImage"]?.effects?.writes).toEqual(["files:uploads"]);
  });

  test("fx.store(files).list(...) infers a read, unannotated", async () => {
    const source = `
import { on, flow, every, store } from "okengine";

export const files = store.files("uploads");

export const sweep = on(
  every("1d"),
  flow("notes.sweep", {
    do: async (_input, fx) => {
      const keys = await fx.store(files).list();
      return { count: keys.length };
    },
  }),
);
`;
    const manifest = await extractFromSources({ "src/flows/sweep.ts": source });

    expect(manifest.flows?.["notes.sweep"]?.effects?.reads).toEqual(["files:uploads"]);
  });
});

describe("extractManifest — kv key methods", () => {
  test("fx.store(kv).delete(key) writes kv:<namespace>, not kv:<identifier>", async () => {
    const source = `
import { on, flow, every, store, signal } from "okengine";

export const draftsKv = store.kv("drafts");
export const draftExpired = signal("draft-expired", { delivery: "broadcast", retries: 0, deadLetter: false });

export const expire = on(
  every("10m"),
  flow("drafts.expire", {
    do: async (_input, fx) => {
      const keys = await fx.store(draftsKv).list();
      for (const key of keys) {
        const ttl = await fx.store(draftsKv).ttlMs(key);
        if (ttl !== null && ttl <= 0) {
          await fx.store(draftsKv).delete(key);
          await fx.emit(draftExpired, { id: key });
        }
      }
    },
  }),
);
`;
    const manifest = await extractFromSources({ "src/flows/drafts.ts": source });
    const effects = manifest.flows?.["drafts.expire"]?.effects;
    expect(effects?.reads).toEqual(["kv:drafts"]);
    expect(effects?.writes).toEqual(["kv:drafts"]);
    expect(effects?.emits).toEqual(["draft-expired"]);
  });
});

describe("extractManifest — fx.deadLetters", () => {
  test("fx.deadLetters(signal) infers reads: [signal:<name>]", async () => {
    const source = `
import { on, flow, http, signal } from "okengine";

export const notify = signal("notify", { delivery: "once" });

export const failed = on(
  http.get("/notifications/failed").public(),
  flow("notifications.failed", {
    do: async (input, fx) => fx.json.withQuery(await fx.deadLetters(notify), input),
  }),
);
`;
    const manifest = await extractFromSources({ "src/flows/failed.ts": source });
    expect(manifest.flows?.["notifications.failed"]?.effects?.reads).toEqual(["signal:notify"]);
  });
});

describe("extractManifest — channel medium binder aliasing", () => {
  test("mail.template(...) resolves through `const mail = channel.email(...)`", async () => {
    const source = `
import { on, flow, http, gate, channel } from "okengine";

const mail = channel.email({ from: "Notes <notes@localhost>" });

export const noteCreatedMail = mail.template("note-created", {
  locales: ["en", "ar"],
});

export const onCreated = on(
  http.post("/hook").public(),
  flow("notes.onCreated", {
    do: async (payload, fx) => {
      await fx.send(noteCreatedMail, { to: "you@localhost", data: payload });
    },
  }),
);
`;
    const manifest = await extractFromSources({ "src/flows/notes.ts": source });

    expect(manifest.flows?.["notes.onCreated"]?.effects?.sends).toEqual(["note-created"]);
    expect(manifest.channels?.["note-created"]?.medium).toBe("email");
  });

  test("sms medium binder alias carries its medium (not defaulted to email)", async () => {
    const source = `
import { on, flow, http, gate, channel } from "okengine";

const otp = channel.sms({});

export const otpTemplate = otp.template("otp-code", {});

export const send = on(
  http.post("/otp").public(),
  flow("notes.sendOtp", {
    do: async (payload, fx) => {
      await fx.send(otpTemplate, { to: "+10000000000", data: payload });
    },
  }),
);
`;
    const manifest = await extractFromSources({ "src/flows/otp.ts": source });

    expect(manifest.flows?.["notes.sendOtp"]?.effects?.sends).toEqual(["otp-code"]);
    expect(manifest.channels?.["otp-code"]?.medium).toBe("sms");
  });
});

describe("extractManifest — flow(name, options) positional signature", () => {
  test("bare flow(name, {...}) extracts name, in, out, effects", async () => {
    const source = `
import { flow } from "okengine";

export const chargeOrder = flow("checkout.chargeOrder", {
  in: ChargeIn,
  out: ChargeOut,
  effects: { reads: ["sql:orders"], writes: ["sql:orders"] },
  do: async (input, fx) => {
    return { ok: true };
  },
});
`;
    const manifest = await extractFromSources({ "src/flows/checkout.ts": source });

    expect(manifest.flows?.["checkout.chargeOrder"]).toBeDefined();
    expect(manifest.flows?.["checkout.chargeOrder"]?.in).toBeDefined();
    expect(manifest.flows?.["checkout.chargeOrder"]?.out).toBeDefined();
    expect(manifest.flows?.["checkout.chargeOrder"]?.effects?.reads).toEqual(["sql:orders"]);
    expect(manifest.flows?.["checkout.chargeOrder"]?.effects?.writes).toEqual(["sql:orders"]);
  });

  test("on(trigger, flow(name, {...})) extracts the same shape as bare flow()", async () => {
    const source = `
import { on, http, flow } from "okengine";

export const getOrder = on(
  http.get("/orders/:id"),
  flow("checkout.getOrder", {
    out: OrderOut,
    effects: { reads: ["sql:orders"] },
    do: async (input, fx) => {
      return { id: input.id };
    },
  }),
);
`;
    const manifest = await extractFromSources({ "src/flows/checkout.ts": source });

    expect(manifest.flows?.["checkout.getOrder"]).toBeDefined();
    expect(manifest.flows?.["checkout.getOrder"]?.trigger?.http?.method).toBe("GET");
    expect(manifest.flows?.["checkout.getOrder"]?.out).toBeDefined();
    expect(manifest.flows?.["checkout.getOrder"]?.effects?.reads).toEqual(["sql:orders"]);
  });

  test("a stray `name:` key inside the options object is ignored — the positional arg wins", async () => {
    // Regression guard for the exact class of AST-shape assumption that broke
    // silently before (channel-alias tracking, `.put()` inference): the
    // compiler must read the flow's identity from the first positional
    // argument, never from a `name` property on the options object, even
    // when one happens to be present.
    const source = `
import { flow } from "okengine";

export const decoy = flow("checkout.realName", {
  name: "checkout.decoyName",
  effects: { reads: ["sql:orders"] },
  do: async () => ({ ok: true }),
});
`;
    const manifest = await extractFromSources({ "src/flows/checkout.ts": source });

    expect(manifest.flows?.["checkout.realName"]).toBeDefined();
    expect(manifest.flows?.["checkout.decoyName"]).toBeUndefined();
  });
});

describe("extractManifest — .public()", () => {
  test("reads the public sentinel from .public()", async () => {
    const source = `
import { on, flow, http } from "okengine";

export const health = on(
  http.get("/health").public(),
  flow("health.check", { do: () => ({ ok: true }) }),
);
`;
    const manifest = await extractFromSources({ "src/flows/health.ts": source });
    expect(manifest.flows?.["health.check"]?.gates).toEqual(["public"]);
  });

  test("does not treat the removed .gate.public property as attach", async () => {
    const source = `
import { on, flow, http } from "okengine";

export const health = on(
  http.get("/health").gate.public,
  flow("health.check", { do: () => ({ ok: true }) }),
);
`;
    const manifest = await extractFromSources({ "src/flows/health.ts": source });
    expect(manifest.flows?.["health.check"]?.gates).toBeUndefined();
  });
});

describe("extractManifest — gate.all", () => {
  test("catalogues the handle and expands .gate(write) onto the flow", async () => {
    const source = `
import { on, flow, http, gate } from "okengine";

export const member = gate.policy("member", ({ auth }) => !!auth.verified);
export const canBook = gate.scope("booking:create");
export const fair = gate.rate({ max: 60, per: "1m", keyBy: "ip" });
export const write = gate.all(member, canBook, fair);

export const create = on(
  http.post("/bookings").gate(write),
  flow("bookings.create", { do: () => ({ ok: true }) }),
);
`;
    const manifest = await extractFromSources({ "src/flows/bookings.ts": source });
    expect(manifest.gates?.write).toEqual({
      kind: "all",
      members: ["member", "booking:create", "rate:sliding-window-counter:60/1m"],
    });
    expect(manifest.flows?.["bookings.create"]?.gates).toEqual([
      "member",
      "booking:create",
      "rate:sliding-window-counter:60/1m",
    ]);
  });

  test("expands .gate(...WRITE) from a const array", async () => {
    const source = `
import { on, flow, http, gate } from "okengine";

export const member = gate.policy("member", ({ auth }) => !!auth.verified);
export const canBook = gate.scope("booking:create");
const WRITE = [member, canBook] as const;

export const create = on(
  http.post("/bookings").gate(...WRITE),
  flow("bookings.create", { do: () => ({ ok: true }) }),
);
`;
    const manifest = await extractFromSources({ "src/flows/bookings.ts": source });
    expect(manifest.flows?.["bookings.create"]?.gates).toEqual(["member", "booking:create"]);
    expect(manifest.gates?.WRITE).toBeUndefined();
  });
});

describe("extractManifest — ai.mcpServer", () => {
  test("stamps mcpServers and infers mcp: calls from .tool()", async () => {
    const source = `
import { ai, flow, on, http, vault } from "okengine";

export const token = vault.secret("GITHUB_TOKEN");
export const github = ai.mcpServer("github", {
  url: "https://mcp.example/github",
  auth: { bearer: token },
  tools: ["create_issue"],
});

export const triage = on(
  http.post("/triage"),
  flow("support.triage", {
    do: async (input, fx) => {
      await fx.ask("ticket-triage", input, { tools: [github.tool("create_issue")] });
    },
  }),
);
`;
    const manifest = await extractFromSources({ "src/ai.ts": source });
    expect(manifest.ai?.mcpServers?.github).toEqual({
      url: "https://mcp.example/github",
      auth: "GITHUB_TOKEN",
      tools: ["create_issue"],
    });
    expect(manifest.flows?.["support.triage"]?.effects?.calls).toEqual(["mcp:github/create_issue"]);
  });
});

describe("extractManifest — file-tree stamps", () => {
  test("pathless http.get() in notes/[id]/get.ts infers /notes/:id and notes.get", async () => {
    const source = `
import { on, flow, http } from "okengine";
export const get = on(
  http.get().public(),
  flow({ do: (input) => input }),
);
`;
    const manifest = await extractFromSources({ "src/flows/notes/[id]/get.ts": source });
    expect(manifest.flows?.["notes.get"]?.trigger).toEqual({
      http: { method: "GET", path: "/notes/:id" },
    });
  });

  test("nameless flow({ do }) still appears on the Manifest", async () => {
    const source = `
import { flow } from "okengine";
export const ping = flow({ do: () => ({ ok: true }) });
`;
    const manifest = await extractFromSources({ "src/flows/notes/ping.ts": source });
    expect(manifest.flows?.["notes.ping"]).toBeDefined();
  });

  test("effects are identical for the same do body in a tree file vs a barrel", async () => {
    const doBody = `
      const rows = await fx.store(db).select().from(notes);
      await fx.emit(noteCreated, { id: "1" });
      await fx.call("notes.ping");
      return rows;
    `;
    const barrel = `
import { on, flow, http, store, signal } from "okengine";
export const db = store.sql("db");
export const notes = { name: "notes" };
export const noteCreated = signal("note-created");
export const get = on(
  http.get("/notes/:id").public(),
  flow("notes.get", {
    do: async (_input, fx) => {${doBody}},
  }),
);
`;
    const tree = `
import { on, flow, http, store, signal } from "okengine";
export const db = store.sql("db");
export const notes = { name: "notes" };
export const noteCreated = signal("note-created");
export const get = on(
  http.get().public(),
  flow({
    do: async (_input, fx) => {${doBody}},
  }),
);
`;
    const barrelManifest = await extractFromSources({ "src/flows/notes/index.ts": barrel });
    const treeManifest = await extractFromSources({ "src/flows/notes/[id]/get.ts": tree });
    const barrelFx = barrelManifest.flows?.["notes.get"]?.effects;
    const treeFx = treeManifest.flows?.["notes.get"]?.effects;
    expect(treeFx).toEqual(barrelFx);
    expect(treeFx?.reads).toBeDefined();
    expect(treeFx?.emits).toBeDefined();
    expect(treeFx?.calls).toBeDefined();
    expect(treeFx?.reads?.length).toBeGreaterThan(0);
    expect(treeFx?.emits?.length).toBeGreaterThan(0);
    expect(treeFx?.calls?.length).toBeGreaterThan(0);
  });
});
