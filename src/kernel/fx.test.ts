import { describe, expect, test } from "bun:test";
import { createCapabilityToken } from "./capability.ts";
import { createEffectLedger, reversibilityOf } from "./effects.ts";
import { fail, formatOkeMessage, lookupOkeError, OKE_ERRORS, OkeError } from "./errors.ts";
import {
  createFx,
  createFxContext,
  jsonResultBrand,
  type Fx,
  type FxStubStoreHandle,
} from "./fx.ts";
import { Redacted } from "./redacted.ts";

/** Narrow stub handle for tests that exercise the in-memory store. */
function stub(fx: Fx, ref: string): FxStubStoreHandle {
  return fx.store(ref) as FxStubStoreHandle;
}

describe("fx — capability enforcement", () => {
  test("undeclared store read throws OKE1001 with flow, resource, and fix", async () => {
    const { fx } = createFxContext({
      flow: "bookings.create",
      effects: { reads: ["sql:bookings"] },
    });

    let err: unknown;
    try {
      await stub(fx, "sql:users").get("u1");
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(OkeError);
    const oke = err as OkeError;
    expect(oke.code).toBe(1001);
    expect(oke.causeText).toBe('Flow "bookings.create" reads "sql:users" without declaring it.');
    expect(oke.fix).toBe('Add "sql:users" to this flow\'s effects.reads.');
    expect(oke.docsUrl).toBe("https://oke.omqkhafi.dev/e/1001");
    expect(oke.message).toBe(formatOkeMessage(1001, oke.causeText, oke.fix, oke.docsUrl));
  });

  test("SQL table with a name column gates as sql:<table>, not sql:<store>", async () => {
    const { createStoreRuntime, field, store } = await import("../elements/store.ts");
    const { memorySqlDriver } = await import("../drivers/index.ts");
    const teams = store.schema.table("teams", {
      id: field.text().primaryKey(),
      name: field.text().notNull(),
    });
    const decl = store.sql("db", { schema: { teams } });
    const rt = createStoreRuntime({
      drivers: { sql: memorySqlDriver },
      sql: { db: { name: "db", primary: {} } },
    });
    rt.register(decl);
    const fx = createFx({
      flow: "teams.list",
      effects: { reads: ["sql:teams"], writes: ["sql:teams"] },
      storeRuntime: rt,
    });
    await fx.store(decl).insert(teams).values({ id: "t1", name: "Eng" });
    const rows = await fx.store(decl).select().from(teams);
    expect(rows).toEqual([{ id: "t1", name: "Eng" }]);
  });

  test("kv ttlMs is a read of kv:<namespace>", async () => {
    const { createStoreRuntime, store } = await import("../elements/store.ts");
    const { memoryKvDriver } = await import("../drivers/index.ts");
    const decl = store.kv("drafts");
    const rt = createStoreRuntime({
      drivers: { kv: memoryKvDriver },
      kv: { drafts: {} },
    });
    rt.register(decl);
    const writer = createFx({
      flow: "drafts.save",
      effects: { writes: ["kv:drafts"] },
      storeRuntime: rt,
    });
    await writer.store(decl).set("ENG-1", { title: "Draft" }, "7d");
    const reader = createFx({
      flow: "drafts.expire",
      effects: { reads: ["kv:drafts"] },
      storeRuntime: rt,
    });
    const ttl = await reader.store(decl).ttlMs("ENG-1");
    expect(ttl).toBeGreaterThan(0);
  });

  test("index driverId is meilisearch before first I/O (not a function, not memory)", async () => {
    const { createStoreRuntime, store } = await import("../elements/store.ts");
    const { meilisearchDriver } = await import("../drivers/index.ts");
    const decl = store.index("tasks");
    const rt = createStoreRuntime({
      drivers: { index: meilisearchDriver },
      index: { tasks: { url: "http://127.0.0.1:7700" } },
    });
    rt.register(decl);
    const fx = createFx({
      flow: "search.seed",
      effects: { writes: ["index:tasks"] },
      storeRuntime: rt,
    });
    expect(fx.store(decl).driverId).toBe("meilisearch");
  });

  test("declared store read succeeds", async () => {
    const fx = createFx({
      flow: "bookings.create",
      effects: { reads: ["sql:bookings"] },
      storeData: { "sql:bookings": { b1: { id: "b1" } } },
    });
    await expect(stub(fx, "sql:bookings").get("b1")).resolves.toEqual({
      id: "b1",
    });
  });
});

describe("fx — effect ledger", () => {
  test("read, write, emit → exactly three ledger entries in order", async () => {
    const ledger = createEffectLedger();
    const fx = createFx({
      flow: "bookings.create",
      effects: {
        reads: ["sql:bookings"],
        writes: ["sql:bookings"],
        emits: ["order-placed"],
      },
      ledger,
    });

    await stub(fx, "sql:bookings").get("b1");
    await stub(fx, "sql:bookings").insert({ seats: 2 });
    await fx.emit("order-placed", { orderId: "o1" });

    expect(ledger.entries).toHaveLength(3);
    expect(ledger.entries.map((e) => e.kind)).toEqual(["read", "write", "emit"]);
    expect(ledger.entries.map((e) => e.resource)).toEqual([
      "sql:bookings",
      "sql:bookings",
      "order-placed",
    ]);
    expect(ledger.entries.map((e) => e.reversibility)).toEqual(["none", "reversible", "deferred"]);
  });

  test("all seven kinds receive the correct reversibility tier via fx", async () => {
    const ledger = createEffectLedger();
    const fx = createFx({
      flow: "kitchen.sink",
      effects: {
        reads: ["sql:bookings"],
        writes: ["sql:bookings"],
        emits: ["order-placed"],
        sends: ["order-confirmed"],
        asks: ["triage@1"],
        secrets: ["STRIPE_KEY"],
        calls: ["payments.charge"],
      },
      ledger,
      secrets: { STRIPE_KEY: "sk_test" },
      aiRuntime: {
        prompts: new Map(),
        agents: new Map(),
        embeds: new Map(),
        autoCacheDisabled: true,
        journalingForced: false,
        denials: [],
        agentRuns: [],
        journal: [],
        async ask() {
          return { ok: true };
        },
        async runAgent() {
          return { ok: true, steps: 0, denials: [], output: {} };
        },
        async *stream() {
          /* no tokens */
        },
        async search() {
          return [];
        },
        async embed() {
          return { vectors: [] };
        },
      } as never,
    });

    await stub(fx, "sql:bookings").get("x");
    await stub(fx, "sql:bookings").set("x", { ok: true });
    await fx.emit("order-placed", {});
    await fx.send("order-confirmed", { to: "u1" });
    await fx.ask("triage@1", {});
    expect((await fx.vault.get("STRIPE_KEY")).reveal()).toBe("sk_test");
    await fx.call("payments.charge", {});

    expect(ledger.entries).toHaveLength(7);
    const kinds = ledger.entries.map((e) => e.kind);
    expect(kinds).toEqual(["read", "write", "emit", "send", "ask", "secret", "call"]);
    for (const entry of ledger.entries) {
      expect(entry.reversibility).toBe(reversibilityOf(entry.kind));
    }
  });

  test("fx.ask with a prompt handle matches effects.asks name@version", async () => {
    const fx = createFx({
      flow: "documents.summarize",
      effects: { asks: ["document-summary@1"] },
      aiRuntime: {
        prompts: new Map(),
        agents: new Map(),
        embeds: new Map(),
        autoCacheDisabled: true,
        journalingForced: false,
        denials: [],
        agentRuns: [],
        journal: [],
        async ask() {
          return { summary: "ok" };
        },
        async runAgent() {
          return { ok: true, steps: 0, denials: [], output: {} };
        },
        async *stream() {
          /* no tokens */
        },
        async search() {
          return [];
        },
        async embed() {
          return { vectors: [] };
        },
      } as never,
    });

    await expect(fx.ask({ name: "document-summary", version: 1 }, {})).resolves.toEqual({
      summary: "ok",
    });
  });
});

describe("fx.vault — object surface", () => {
  /** Minimal in-memory adapter covering the surface `fx.vault` uses. */
  function memoryAdapter() {
    const rows = new Map<string, { value: string; version: number }>();
    const actors: string[] = [];
    return {
      rows,
      actors,
      adapter: {
        id: "memory",
        async get(path: string) {
          const row = rows.get(path);
          return row === undefined ? undefined : { path, ...row };
        },
        async set(path: string, value: string, opts?: { actor?: { id?: string } }) {
          if (opts?.actor?.id) actors.push(opts.actor.id);
          const version = (rows.get(path)?.version ?? 0) + 1;
          rows.set(path, { value, version });
          return { path, value, version };
        },
        async rotate(path: string, value: string) {
          const version = (rows.get(path)?.version ?? 0) + 1;
          rows.set(path, { value, version });
          return { path, value, version };
        },
        async delete(path: string) {
          return rows.delete(path);
        },
        async list(opts?: { prefix?: string }) {
          return [...rows.keys()]
            .filter((p) => opts?.prefix === undefined || p.startsWith(opts.prefix))
            .map((path) => ({ path, version: rows.get(path)!.version }));
        },
        async status() {
          return { sealed: false, initialized: true, secretCount: rows.size };
        },
      },
    };
  }

  test("mutations run through the adapter, ledger `secret`, and carry the flow actor", async () => {
    const { adapter, actors, rows } = memoryAdapter();
    const ledger = createEffectLedger();
    const fx = createFx({
      flow: "ops.rotateKey",
      effects: { secrets: ["prod/api/stripe"] },
      ledger,
      // The adapter's structural shape is all `fx.vault` consumes.
      vaultAdapter: adapter as never,
    });

    expect(await fx.vault.set("prod/api/stripe", "sk_1")).toEqual({
      path: "prod/api/stripe",
      version: 1,
    });
    expect(await fx.vault.rotate("prod/api/stripe", "sk_2")).toEqual({
      path: "prod/api/stripe",
      version: 2,
    });
    expect(await fx.vault.list("prod/")).toEqual(["prod/api/stripe"]);
    expect(await fx.vault.status()).toEqual({
      sealed: false,
      initialized: true,
      backend: "memory",
    });
    expect(await fx.vault.delete("prod/api/stripe")).toBe(true);

    expect(rows.size).toBe(0);
    expect(actors).toEqual(["ops.rotateKey"]);
    expect(ledger.entries.map((e) => e.kind)).toEqual(["secret", "secret", "secret"]);
  });

  test("an undeclared path is refused before the adapter is touched", async () => {
    const { adapter, rows } = memoryAdapter();
    const fx = createFx({
      flow: "ops.rotateKey",
      effects: { secrets: ["prod/api/stripe"] },
      vaultAdapter: adapter as never,
    });

    await expect(fx.vault.set("prod/api/other", "sk_1")).rejects.toThrow(/OKE1006/);
    expect(rows.size).toBe(0);
  });

  test("mutations without a bound adapter name the missing backend", async () => {
    const fx = createFx({
      flow: "ops.rotateKey",
      effects: { secrets: ["prod/api/stripe"] },
    });

    await expect(fx.vault.set("prod/api/stripe", "sk_1")).rejects.toThrow(
      /fx\.vault\.set needs a bound Vault backend/,
    );
    await expect(fx.vault.status()).rejects.toThrow(
      /fx\.vault\.status needs a bound Vault backend/,
    );
  });
});

describe("fx — wholesale swap", () => {
  test("fx is swappable wholesale (plain object interface)", async () => {
    const calls: string[] = [];

    const fake: Fx = {
      store() {
        throw new Error("store must not be used");
      },
      runs: {
        query: async () => {
          throw new Error("runs must not be used");
        },
        all: async () => {
          throw new Error("runs must not be used");
        },
        window: async () => {
          throw new Error("runs must not be used");
        },
        checkSlo: async () => {
          throw new Error("runs must not be used");
        },
      },
      async emit(signal) {
        calls.push(`emit:${typeof signal === "string" ? signal : signal.name}`);
      },
      async call() {
        return null;
      },
      clock: {
        now: () => 0,
        ago: () => 0,
        fromNow: () => 0,
        duration: () => 0,
        sleep: async () => undefined,
      },
      vault: {
        async get() {
          return new Redacted("");
        },
        async set() {
          throw new Error("vault.set must not be used");
        },
        async rotate() {
          throw new Error("vault.rotate must not be used");
        },
        async delete() {
          throw new Error("vault.delete must not be used");
        },
        async list() {
          return [];
        },
        async status() {
          return { sealed: false, initialized: true, backend: "memory" };
        },
      },
      cache: {
        get: async () => undefined,
        set: async () => undefined,
        getOrSet: async (_k, _t, produce) => produce(),
      },
      async send() {
        return { ok: true };
      },
      async sendOtp() {
        return { ok: true };
      },
      async verifyOtp() {
        return { ok: true };
      },
      async deliverOtp(opts) {
        return { ok: true as const, channel: opts.only ?? opts.channels[0] ?? "email" };
      },
      async ask() {
        return {};
      },
      async search() {
        return [];
      },
      async run() {
        return {};
      },
      async *stream() {
        /* empty */
      },
      log: {
        debug() {},
        info() {},
        warn() {},
        error() {},
      },
      t: (key) => key,
      locale: "en",
      id: () => "fixed-id",
      auth: { userId: "u1", scopes: new Set(["a"]) },
      operator: { id: null },
      principal: { userId: "u1", operatorId: null, scopes: new Set(["a"]) },
      tenant: { id: "t1" },
      fail,
      json: {
        ok(value, opts) {
          return { [jsonResultBrand]: true, status: 200, value, meta: opts?.meta };
        },
        create(value) {
          return { [jsonResultBrand]: true, status: 201, value };
        },
        empty() {
          return { [jsonResultBrand]: true, status: 204 };
        },
        with(dataOrPage: unknown, meta?: Record<string, unknown>) {
          if (meta !== undefined) {
            return { [jsonResultBrand]: true, status: 200, value: dataOrPage, meta };
          }
          const page = dataOrPage as { data: unknown; meta: Record<string, unknown> };
          return { [jsonResultBrand]: true, status: 200, value: page.data, meta: page.meta };
        },
        withQuery(rows) {
          return { [jsonResultBrand]: true, status: 200, value: [...rows], meta: {} };
        },
      },
      async step(_name, fn) {
        return fn();
      },
      get signal() {
        return new AbortController().signal;
      },
      all(thunks) {
        return Promise.all(thunks.map((t) => t())) as never;
      },
      race(thunks) {
        return Promise.race(thunks.map((t) => t()));
      },
      retry(fn) {
        return Promise.resolve().then(fn);
      },
      async using(acquire, release, use) {
        const resource = await acquire();
        try {
          return await use(resource);
        } finally {
          await release(resource);
        }
      },
    };

    // Any code that accepts `Fx` can run against a total replacement.
    async function runFlow(fx: Fx): Promise<string> {
      await fx.emit("order-placed", { id: fx.id() });
      return fx.t("hello");
    }

    await expect(runFlow(fake)).resolves.toBe("hello");
    expect(calls).toEqual(["emit:order-placed"]);
  });
});

describe("fx.t — catalogs", () => {
  test("resolves locale then default with ICU values", () => {
    const fx = createFx({
      flow: "x",
      effects: {},
      i18n: {
        locale: "ar",
        defaultLocale: "en",
        catalogs: {
          en: {
            "errors.notFound": "Not found",
            greeting: "Hello, {name}",
            items: "{count, plural, one {# item} other {# items}}",
          },
          ar: { greeting: "مرحباً، {name}" },
        },
      },
    });
    expect(fx.locale).toBe("ar");
    expect(fx.t("greeting", { name: "Ada" })).toBe("مرحباً، Ada");
    expect(fx.t("errors.notFound")).toBe("Not found");
    expect(fx.t("items", { count: 2 })).toBe("2 items");
    expect(fx.t("missing")).toBe("missing");
  });
});

describe("fx.clock — relative instants", () => {
  test("ago / fromNow / duration use the injected now and duration strings", () => {
    const fx = createFx({ flow: "sessions.sweepExpired", effects: {}, now: () => 1_000_000 });
    expect(fx.clock.now()).toBe(1_000_000);
    expect(fx.clock.duration("30d")).toBe(30 * 86_400_000);
    expect(fx.clock.ago("30d")).toBe(1_000_000 - 30 * 86_400_000);
    expect(fx.clock.fromNow("14d")).toBe(1_000_000 + 14 * 86_400_000);
    expect(fx.clock.duration("nope")).toBe(0);
    expect(fx.clock.ago("nope")).toBe(1_000_000);
    expect(fx.clock.fromNow("200ms")).toBe(1_000_200);
  });
});

describe("fx.json", () => {
  test("with accepts a page or (data, meta)", () => {
    const fx = createFx({ flow: "x", effects: {} });
    const items = [{ id: "n_1" }];
    const meta = { mode: "offset", total: 1, limit: 1, offset: 0 };
    const fromPage = fx.json.with({ data: items, meta });
    const fromArgs = fx.json.with(items, meta);
    expect(fromPage).toMatchObject({ status: 200, value: items, meta });
    expect(fromArgs).toMatchObject({ status: 200, value: items, meta });
    expect(() => fx.json.with(items as never)).toThrow(/pass \(data, meta\)/);
  });

  test("withQuery pages rows and skips auto-eq on id", () => {
    const fx = createFx({ flow: "x", effects: {} });
    const rows = [
      { id: "c_1", issueId: "iss_1", title: "Ship" },
      { id: "c_2", issueId: "iss_1", title: "Later" },
      { id: "c_3", issueId: "iss_2", title: "Ship docs" },
    ];
    const page = fx.json.withQuery(rows, { id: "c_1", q: "ship", limit: 10 });
    expect(page).toMatchObject({
      status: 200,
      value: [
        { id: "c_1", issueId: "iss_1", title: "Ship" },
        { id: "c_3", issueId: "iss_2", title: "Ship docs" },
      ],
    });
    expect(page.meta).toMatchObject({ mode: "offset", total: 2, next: null });

    const filtered = fx.json.withQuery(rows, { issueId: "iss_1", limit: 10 });
    expect(filtered.value).toEqual(rows.slice(0, 2));
  });
});

describe("errors — registry", () => {
  test("OKE1042 is reserved with the §21 shape", () => {
    const def = OKE_ERRORS.ORPHAN_EMIT;
    expect(def.code).toBe(1042);
    expect(lookupOkeError(1042)).toEqual(def);
    const err = new OkeError(def, {
      flow: "bookings.create",
      resource: "order-placed",
    });
    expect(err.message).toContain("OKE1042");
    expect(err.message).toContain("no subscriber");
    expect(err.message).toContain("https://oke.omqkhafi.dev/e/1042");
    expect(err.message).toContain("→");
  });

  test("OKE1043 is reserved for signal schema emit failures", () => {
    const def = OKE_ERRORS.SIGNAL_SCHEMA;
    expect(def.code).toBe(1043);
    expect(lookupOkeError(1043)).toEqual(def);
    const err = new OkeError(def, {
      resource: "order-placed",
      detail: "total: Expected number, received string",
    });
    expect(err.message).toContain("OKE1043");
    expect(err.message).toContain("order-placed");
    expect(err.message).toContain("https://oke.omqkhafi.dev/e/1043");
  });

  test("fx.fail returns a value, not an exception", () => {
    const fx = createFx({ flow: "x", effects: {} });
    const result = fx.fail(
      "FlightFull",
      { seatsLeft: 0 },
      {
        message: "full",
      },
    );
    expect(result).toEqual({
      data: null,
      error: { code: "FlightFull", data: { seatsLeft: 0 }, message: "full" },
    });
  });

  test("capability token allows only declared resources", () => {
    const token = createCapabilityToken("f", {
      reads: ["sql:a"],
      emits: ["s"],
    });
    expect(token.allows("read", "sql:a")).toBe(true);
    expect(token.allows("read", "sql:b")).toBe(false);
    expect(() => token.assert("emit", "missing")).toThrow(OkeError);
  });
});
