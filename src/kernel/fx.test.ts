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
        with(data, meta) {
          return { [jsonResultBrand]: true, status: 200, value: data, meta };
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
