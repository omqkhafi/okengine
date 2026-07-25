import { describe, expect, test } from "bun:test";
import { createCapabilityToken } from "./capability.ts";
import { createEffectLedger, reversibilityOf } from "./effects.ts";
import {
  fail,
  formatOkeMessage,
  lookupOkeError,
  OKE_ERRORS,
  OkeError,
} from "./errors.ts";
import {
  createFx,
  createFxContext,
  type Fx,
  type FxStubStoreHandle,
} from "./fx.ts";

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
    expect(oke.causeText).toBe(
      'Flow "bookings.create" reads "sql:users" without declaring it.',
    );
    expect(oke.fix).toBe(
      'Add "sql:users" to this flow\'s effects.reads.',
    );
    expect(oke.docsUrl).toBe("https://okengine.vercel.app/e/1001");
    expect(oke.message).toBe(
      formatOkeMessage(1001, oke.causeText, oke.fix, oke.docsUrl),
    );
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
    expect(ledger.entries.map((e) => e.kind)).toEqual([
      "read",
      "write",
      "emit",
    ]);
    expect(ledger.entries.map((e) => e.resource)).toEqual([
      "sql:bookings",
      "sql:bookings",
      "order-placed",
    ]);
    expect(ledger.entries.map((e) => e.reversibility)).toEqual([
      "none",
      "reversible",
      "deferred",
    ]);
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
    });

    await stub(fx, "sql:bookings").get("x");
    await stub(fx, "sql:bookings").set("x", { ok: true });
    await fx.emit("order-placed", {});
    await fx.send("order-confirmed", { to: "u1" });
    await fx.ask("triage@1", {});
    expect(fx.vault("STRIPE_KEY")).toBe("sk_test");
    await fx.call("payments.charge", {});

    expect(ledger.entries).toHaveLength(7);
    const kinds = ledger.entries.map((e) => e.kind);
    expect(kinds).toEqual([
      "read",
      "write",
      "emit",
      "send",
      "ask",
      "secret",
      "call",
    ]);
    for (const entry of ledger.entries) {
      expect(entry.reversibility).toBe(reversibilityOf(entry.kind));
    }
  });
});

describe("fx — wholesale swap", () => {
  test("fx is swappable wholesale (plain object interface)", async () => {
    const calls: string[] = [];

    const fake: Fx = {
      store() {
        throw new Error("store must not be used");
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
      vault() {
        return "";
      },
      cache: {
        get: async () => undefined,
        set: async () => undefined,
        getOrSet: async (_k, _t, produce) => produce(),
      },
      async send() {
        return { ok: true };
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
      id: () => "fixed-id",
      auth: { userId: "u1", scopes: new Set(["a"]) },
      operator: { id: null },
      tenant: { id: "t1" },
      fail,
      async step(_name, fn) {
        return fn();
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
    expect(err.message).toContain("https://okengine.vercel.app/e/1042");
    expect(err.message).toContain("→");
  });

  test("fx.fail returns a value, not an exception", () => {
    const fx = createFx({ flow: "x", effects: {} });
    const result = fx.fail("FlightFull", { seatsLeft: 0 }, {
      message: "full",
    });
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
