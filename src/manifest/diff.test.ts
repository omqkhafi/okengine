import { describe, expect, test } from "bun:test";
import { diffManifest, highestSeverity, __test__ } from "./diff.ts";
import type { DiffCategory, Manifest, ManifestChange } from "./types.ts";
import { parseManifest } from "./validate.ts";

const baseUrl = new URL("./fixtures/base.manifest.json", import.meta.url);

async function loadBase(): Promise<Manifest> {
  return parseManifest(await Bun.file(baseUrl).text());
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function categoriesOf(changes: ManifestChange[]): DiffCategory[] {
  return [...new Set(changes.map((c) => c.category))];
}

function hasCategory(
  changes: ManifestChange[],
  category: DiffCategory,
  pathIncludes?: string,
): boolean {
  return changes.some(
    (c) => c.category === category && (pathIncludes === undefined || c.path.includes(pathIncludes)),
  );
}

describe("diffManifest — fixture pairs", () => {
  test("1 · identical manifests → no changes", async () => {
    const m = await loadBase();
    const result = diffManifest(m, clone(m));
    expect(result.changes).toEqual([]);
    expect(result.severity).toBeNull();
  });

  test("2 · removed error is contract-breaking (subtle)", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.flows!["reports.export"]!.errors = ["NotFound"];
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "contract-breaking", "Forbidden")).toBe(true);
    expect(result.severity).toBe("contract-breaking");
  });

  test("3 · widened gate staff → member is permission-widening (subtle)", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.flows!["reports.export"]!.gates = ["member"];
    after.gates!["staff"] = {
      kind: "policy",
      roles: ["member"],
    };
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "permission-widening")).toBe(true);
    expect(result.severity).toBe("permission-widening");
  });

  test("4 · new write effect is effect-widening", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.flows!["reports.export"]!.effects = {
      ...after.flows!["reports.export"]!.effects,
      writes: ["sql:reports"],
    };
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "effect-widening", "writes")).toBe(true);
    expect(result.severity).toBe("effect-widening");
  });

  test("5 · gates reordered only is no-impact", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.flows!["orders.create"]!.gates = ["rate:sliding-window-counter:300/1m", "member"];
    const result = diffManifest(before, after);
    expect(result.changes.length).toBeGreaterThan(0);
    expect(categoriesOf(result.changes)).toEqual(["no-impact"]);
    expect(result.severity).toBe("no-impact");
  });

  test("6 · required field added to in-schema is contract-breaking", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.flows!["orders.create"]!.in = {
      type: "object",
      required: ["sku", "qty"],
      properties: {
        sku: { type: "string" },
        qty: { type: "integer" },
      },
    };
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "contract-breaking", "/in")).toBe(true);
  });

  test("7 · flow became public (all gates removed) is permission-widening", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.flows!["reports.export"]!.gates = [];
    const result = diffManifest(before, after);
    expect(result.changes.some((c) => c.summary.includes("flow became public"))).toBe(true);
    expect(result.severity).toBe("permission-widening");
  });

  test("8 · new send / ask / secret effects are effect-widening", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.flows!["orders.create"]!.effects = {
      ...after.flows!["orders.create"]!.effects,
      sends: ["order-confirmed"],
      asks: ["triage@1"],
      secrets: ["STRIPE_KEY"],
    };
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "effect-widening", "sends")).toBe(true);
    expect(hasCategory(result.changes, "effect-widening", "asks")).toBe(true);
    expect(hasCategory(result.changes, "effect-widening", "secrets")).toBe(true);
  });

  test("9 · source / deprecated / cache-only edits are no-impact", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.flows!["orders.create"]!.source = "src/flows/orders.ts:99";
    after.flows!["orders.create"]!.deprecated = {
      since: "1.1",
      replaceWith: "orders.v2",
    };
    after.flows!["orders.create"]!.cache = "5m";
    const result = diffManifest(before, after);
    expect(categoriesOf(result.changes)).toEqual(["no-impact"]);
  });

  test("10 · signal delivery change is contract-breaking", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.signals!["order-placed"]!.delivery = "broadcast";
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "contract-breaking", "delivery")).toBe(true);
  });

  test("10b · live retention change is contract-breaking", async () => {
    const before = await loadBase();
    before.signals!["order-placed"]!.delivery = "live";
    const after = clone(before);
    after.signals!["order-placed"]!.retention = { maxCount: 10 };
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "contract-breaking", "retention")).toBe(true);
  });

  test("11 · rate limit expression widened is permission-widening", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.flows!["orders.create"]!.gates = ["member", "rate:sliding-window-counter:500/1m"];
    const result = diffManifest(before, after);
    expect(
      result.changes.some(
        (c) => c.category === "permission-widening" && c.summary.includes("rate limit widened"),
      ),
    ).toBe(true);
  });

  test("12 · prompt version bump is effect-widening", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.ai!.prompts!.triage!.version = 2;
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "effect-widening", "version")).toBe(true);
  });

  test("13 · tenancy isolation weakened is permission-widening", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.tenancy = { isolation: "row" };
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "permission-widening", "tenancy")).toBe(true);
  });

  test("14 · effects array reorder only is no-impact", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.flows!["orders.create"]!.effects = {
      reads: ["sql:orders"],
      writes: ["sql:orders"],
      emits: ["order-placed"],
    };
    // force a visible reorder on reads by duplicating via another resource then sorting differently
    before.flows!["orders.create"]!.effects = {
      reads: ["sql:orders", "sql:reports"],
      writes: ["sql:orders"],
      emits: ["order-placed"],
    };
    after.flows!["orders.create"]!.effects = {
      reads: ["sql:reports", "sql:orders"],
      writes: ["sql:orders"],
      emits: ["order-placed"],
    };
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "no-impact", "reads")).toBe(true);
    expect(hasCategory(result.changes, "effect-widening")).toBe(false);
  });

  test("15 · removing a flow is contract-breaking; adding one is no-impact", async () => {
    const before = await loadBase();
    const after = clone(before);
    delete after.flows!["reports.export"];
    after.flows!["health.ping"] = {
      trigger: { http: { method: "GET", path: "/health" } },
      effects: { reads: [] },
    };
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "contract-breaking", "reports.export")).toBe(true);
    expect(hasCategory(result.changes, "no-impact", "health.ping")).toBe(true);
  });

  test("16 · plugin intercept added is permission-widening", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.plugins!.audit!.intercepts = ["afterHandle"];
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "permission-widening", "plugins")).toBe(true);
  });

  test("17 · availability SLO lowered is contract-breaking", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.flows!["reports.export"]!.slo = {
      availability: "99.0%",
      latency: { p99: "200ms" },
    };
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "contract-breaking", "availability")).toBe(true);
  });

  test("18 · PII classification removed is permission-widening", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.stores!.db!.tables!.orders!.classifications = {};
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "permission-widening", "classifications")).toBe(true);
  });
});

describe("diffManifest — additional branches", () => {
  test("app / oke identity changes are contract-breaking", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.app = "other";
    after.oke = "1.0";
    const r1 = diffManifest(before, after);
    expect(hasCategory(r1.changes, "contract-breaking", "/app")).toBe(true);

    const afterOke = clone(before) as Manifest & { oke: string };
    (afterOke as { oke: string }).oke = "9.9" as Manifest["oke"];
    const r2 = diffManifest(before, afterOke as Manifest);
    expect(hasCategory(r2.changes, "contract-breaking", "/oke")).toBe(true);
  });

  test("trigger / out schema / durable / live / plane / cost / pii / steps", async () => {
    const before = await loadBase();
    const after = clone(before);
    const flow = after.flows!["orders.create"]!;
    flow.trigger = { http: { method: "PUT", path: "/orders" } };
    flow.out = {
      type: "object",
      properties: { id: { type: "number" } },
    };
    flow.durable = true;
    flow.live = "order-status";
    flow.plane = "operator";
    flow.cost = { estimatePerCall: 1, budget: 2 };
    flow.pii = "allow";
    flow.steps = ["a", "b"];
    flow.nondeterministic = true;
    flow.breaking = true;
    flow.cacheKeys = "computed:x";
    flow.errors = { OutOfStock: { type: "object", properties: { left: { type: "number" } } } };

    before.flows!["orders.create"]!.errors = {
      OutOfStock: { type: "object", properties: { left: { type: "string" } } },
    };
    before.flows!["orders.create"]!.plane = "user";
    before.flows!["orders.create"]!.steps = ["a"];

    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "contract-breaking", "trigger")).toBe(true);
    expect(hasCategory(result.changes, "contract-breaking", "/out")).toBe(true);
    expect(hasCategory(result.changes, "effect-widening", "durable")).toBe(true);
    expect(hasCategory(result.changes, "effect-widening", "live")).toBe(true);
    expect(hasCategory(result.changes, "effect-widening", "steps")).toBe(true);
    expect(hasCategory(result.changes, "permission-widening", "pii")).toBe(true);
  });

  test("operator → user plane is permission-widening; durable off is contract-breaking", async () => {
    const before = await loadBase();
    before.flows!["orders.create"]!.plane = "operator";
    before.flows!["orders.create"]!.durable = true;
    const after = clone(before);
    after.flows!["orders.create"]!.plane = "user";
    after.flows!["orders.create"]!.durable = false;
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "permission-widening", "plane")).toBe(true);
    expect(hasCategory(result.changes, "contract-breaking", "durable")).toBe(true);
  });

  test("signal retries/deadLetter/optional and store facet", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.signals!["order-placed"]!.retries = 1;
    after.signals!["order-placed"]!.deadLetter = false;
    after.signals!["order-placed"]!.optional = true;
    after.stores!.db!.facet = "kv";
    after.stores!.db!.namespaces = ["cache"];
    delete after.stores!.db!.tables;
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "contract-breaking", "retries")).toBe(true);
    expect(hasCategory(result.changes, "contract-breaking", "deadLetter")).toBe(true);
    expect(hasCategory(result.changes, "contract-breaking", "facet")).toBe(true);
  });

  test("store.kv durable on is effect-widening; off is contract-breaking", async () => {
    const before = await loadBase();
    before.stores!.db!.facet = "kv";
    before.stores!.db!.namespaces = ["cache"];
    delete before.stores!.db!.tables;
    const on = clone(before);
    on.stores!.db!.durable = true;
    expect(hasCategory(diffManifest(before, on).changes, "effect-widening", "durable")).toBe(true);
    const off = clone(on);
    off.stores!.db!.durable = false;
    expect(hasCategory(diffManifest(on, off).changes, "contract-breaking", "durable")).toBe(true);
  });

  test("clocks, vault, channels, journeys, drivers, i18n, topology, images", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.clocks!.nightly!.cron = "0 1 * * *";
    after.vault!.STRIPE_KEY!.schema = { type: "number" };
    after.channels!["order-confirmed"]!.locales = ["en", "fr"];
    after.channels!["order-confirmed"]!.medium = "sms";
    after.journeys = {
      checkout: {
        slo: { availability: "99%" },
        composes: "98%",
        flows: ["orders.create"],
      },
    };
    after.drivers!.prod = ["postgres"];
    after.i18n!.locales = ["en"];
    after.topology = "services";
    after.images = { "store.sql": "postgres:17" };
    after.ai!.agents!.support!.tools = ["orders.create", "reports.export"];
    after.ai!.agents!.support!.maxSteps = 9;
    after.ai!.prompts!.triage!.budget = { maxCostPerCall: 0.5 };

    // seed journey then lower
    before.journeys = {
      checkout: {
        slo: { availability: "99.9%" },
        composes: "99.5%",
        flows: ["orders.create", "reports.export"],
      },
    };

    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "contract-breaking", "clocks")).toBe(true);
    expect(hasCategory(result.changes, "contract-breaking", "schema")).toBe(true);
    expect(hasCategory(result.changes, "contract-breaking", "medium")).toBe(true);
    expect(hasCategory(result.changes, "effect-widening", "tools")).toBe(true);
    expect(hasCategory(result.changes, "contract-breaking", "topology")).toBe(true);
    expect(hasCategory(result.changes, "no-impact", "images")).toBe(true);
  });

  test("tenancy removed / i18n removed / drivers env removed", async () => {
    const before = await loadBase();
    const after = clone(before);
    delete after.tenancy;
    delete after.i18n;
    delete after.drivers;
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "permission-widening", "tenancy")).toBe(true);
    expect(hasCategory(result.changes, "contract-breaking", "i18n")).toBe(true);
    expect(hasCategory(result.changes, "contract-breaking", "drivers")).toBe(true);
  });

  test("gate definition max widen and strategy change", async () => {
    const before = await loadBase();
    before.gates!.fair = {
      kind: "rate",
      strategy: "sliding-window-counter",
      max: 10,
      per: "1m",
    };
    const after = clone(before);
    after.gates!.fair = {
      kind: "rate",
      strategy: "token-bucket",
      max: 10,
      per: "1m",
    };
    const r1 = diffManifest(before, after);
    expect(hasCategory(r1.changes, "contract-breaking", "strategy")).toBe(true);

    const afterMax = clone(before);
    afterMax.gates!.fair = {
      kind: "rate",
      strategy: "sliding-window-counter",
      max: 100,
      per: "1m",
    };
    const r2 = diffManifest(before, afterMax);
    expect(hasCategory(r2.changes, "permission-widening")).toBe(true);
  });

  test("slo latency loosened; in schema type change; error added no-impact", async () => {
    const before = await loadBase();
    const after = clone(before);
    after.flows!["reports.export"]!.slo = {
      availability: "99.9%",
      latency: { p99: "500ms" },
    };
    after.flows!["orders.create"]!.in = {
      type: "object",
      required: ["sku"],
      properties: {
        sku: { type: "number" },
        qty: { type: "integer" },
      },
    };
    after.flows!["orders.create"]!.errors = ["OutOfStock", "Gone"];
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "contract-breaking", "latency")).toBe(true);
    expect(hasCategory(result.changes, "contract-breaking", "/in")).toBe(true);
    expect(hasCategory(result.changes, "no-impact", "Gone")).toBe(true);
  });

  test("highestSeverity picks the strongest category", () => {
    expect(highestSeverity([])).toBeNull();
    expect(
      highestSeverity([
        {
          path: "/a",
          category: "no-impact",
          kind: "changed",
          summary: "a",
        },
        {
          path: "/b",
          category: "effect-widening",
          kind: "changed",
          summary: "b",
        },
        {
          path: "/c",
          category: "permission-widening",
          kind: "changed",
          summary: "c",
        },
      ]),
    ).toBe("permission-widening");
  });
});

describe("diff helpers — branch coverage", () => {
  test("parseRateGate / parsePercent / parseDurationMs", () => {
    expect(__test__.parseRateGate("rate:sliding-window-counter:300/1m")).toEqual({
      strategy: "sliding-window-counter",
      max: 300,
      per: "1m",
    });
    expect(__test__.parseRateGate("member")).toBeUndefined();
    expect(__test__.parsePercent("99.9%")).toBe(99.9);
    expect(__test__.parsePercent("nope")).toBeUndefined();
    expect(__test__.parsePercent(undefined)).toBeUndefined();
    expect(__test__.parseDurationMs("200ms")).toBe(200);
    expect(__test__.parseDurationMs("2s")).toBe(2000);
    expect(__test__.parseDurationMs("1m")).toBe(60_000);
    expect(__test__.parseDurationMs("1h")).toBe(3_600_000);
    expect(__test__.parseDurationMs("1d")).toBeUndefined();
  });

  test("schemaBreaksClients enum narrowing and out property removal", () => {
    expect(
      __test__.schemaBreaksClients(
        {
          type: "object",
          properties: { format: { type: "string", enum: ["csv", "json"] } },
        },
        {
          type: "object",
          properties: { format: { type: "string", enum: ["csv"] } },
        },
        "in",
      ),
    ).toBe(true);

    expect(
      __test__.schemaBreaksClients(
        {
          type: "object",
          properties: { url: { type: "string" }, extra: { type: "string" } },
        },
        {
          type: "object",
          properties: { url: { type: "string" } },
        },
        "out",
      ),
    ).toBe(true);

    expect(__test__.schemaBreaksClients({ type: "string" }, { type: "number" }, "in")).toBe(true);

    expect(
      __test__.schemaBreaksClients(
        {
          type: "object",
          properties: { a: { type: "string" } },
          required: [],
        },
        {
          type: "object",
          properties: { a: { type: "string" }, b: { type: "string" } },
          required: [],
        },
        "in",
      ),
    ).toBe(false);
  });

  test("classificationWeakened detects pii/sensitive loss", () => {
    expect(
      __test__.classificationWeakened({ email: { pii: true } }, { email: { pii: false } }),
    ).toBe(true);
    expect(__test__.classificationWeakened({ token: { sensitive: true } }, {})).toBe(true);
    expect(__test__.classificationWeakened({ email: "pii" }, { email: ["pii"] })).toBe(false);
    expect(__test__.classificationWeakened({ email: ["sensitive"] }, { email: ["pii"] })).toBe(
      true,
    );
    expect(__test__.classificationWeakened(null, {})).toBe(false);
    expect(__test__.classificationWeakened({ a: "pii" }, null)).toBe(true);
    expect(
      __test__.classificationWeakened(
        { email: { sensitive: true } },
        { email: { sensitive: false } },
      ),
    ).toBe(true);
  });
});

describe("diffManifest — line coverage sweep", () => {
  test("covers remaining flow/signal/store/ai/i18n branches", async () => {
    const before = await loadBase();
    before.flows!["orders.create"]!.plane = "user";
    before.flows!["orders.create"]!.steps = ["a", "b"];
    before.flows!["orders.create"]!.nondeterministic = true;
    before.flows!["orders.create"]!.cost = { budget: 5 };
    before.flows!["orders.create"]!.in = "CreateOrder";
    before.flows!["orders.create"]!.effects = {
      reads: ["sql:orders", "sql:reports"],
      writes: ["sql:orders"],
      emits: ["order-placed"],
      calls: ["reports.export"],
    };
    before.flows!["orders.create"]!.errors = ["OutOfStock", "Gone"];
    before.flows!["internal"] = {
      effects: { reads: ["sql:orders"] },
    };
    before.signals!["order-placed"]!.schema = {
      type: "object",
      properties: { id: { type: "string" } },
    };
    before.signals!["order-placed"]!.optional = true;
    before.gates!.staff = { kind: "policy", roles: ["staff", "admin"], scopes: ["x"] };
    before.vault!.STRIPE_KEY!.description = "old";
    before.channels!["order-confirmed"]!.from = "a@b.c";
    before.plugins!.audit!.version = "1.0.0";
    before.stores!.db!.classifications = { email: { pii: true } };
    before.stores!.db!.tables!.orders!.columns = {
      email: { pii: true },
    };
    before.stores!.db!.buckets = ["a", "b"];
    before.stores!.db!.indexes = ["ix"];
    before.ai!.models!.smart = { provider: "anthropic", tier: "opus" };
    before.ai!.prompts!.triage = {
      version: 1,
      evals: "./evals/t.jsonl",
      budget: { maxCostPerCall: 0.05 },
      in: { type: "object" },
      out: { type: "object" },
    };
    before.ai!.agents!.support = {
      tools: ["orders.create", "reports.export"],
      maxSteps: 5,
      budget: { maxCostPerRun: 1 },
    };
    before.drivers = { prod: ["postgres", "redis"], dev: ["sqlite"] };
    before.i18n = {
      locales: ["en"],
      default: "en",
      dir: { en: "ltr" },
    };
    delete before.tenancy;
    delete before.topology;

    const after = clone(before);
    delete after.flows!["orders.create"]!.plane;
    after.flows!["orders.create"]!.steps = ["a"];
    after.flows!["orders.create"]!.nondeterministic = false;
    after.flows!["orders.create"]!.cost = { budget: 1 };
    delete after.flows!["orders.create"]!.live;
    after.flows!["orders.create"]!.durable = false;
    after.flows!["orders.create"]!.in = "CreateOrderV2";
    after.flows!["orders.create"]!.out = {
      type: "object",
      properties: { id: { type: "string" }, ok: { type: "boolean" } },
    };
    delete after.flows!["orders.create"]!.effects!.calls;
    after.flows!["orders.create"]!.effects!.reads = ["sql:orders"];
    after.flows!["orders.create"]!.errors = ["Gone", "OutOfStock"];
    after.flows!["internal"]!.trigger = {
      http: { method: "GET", path: "/internal" },
    };
    delete after.flows!["reports.export"]!.trigger;
    delete after.flows!["reports.export"]!.in;
    after.flows!["reports.export"]!.out = undefined;
    after.flows!["reports.export"]!.slo = undefined;
    after.flows!["newborn"] = {
      in: { type: "object", properties: { x: { type: "string" } } },
      slo: { availability: "99.99%" },
    };
    // non-breaking out additive property on orders
    after.flows!["orders.create"]!.out = {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        extra: { type: "string" },
      },
    };
    before.flows!["orders.create"]!.out = {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    };

    after.signals!["order-placed"]!.retries = 9;
    after.signals!["order-placed"]!.deadLetter = true;
    after.signals!["order-placed"]!.optional = false;
    after.signals!["order-placed"]!.schema = {
      type: "object",
      properties: { id: { type: "string" }, n: { type: "number" } },
    };

    after.gates!.staff = { kind: "policy", roles: ["staff"], scopes: [] };
    after.gates!.member = { kind: "policy", roles: ["member"], policy: "member" };
    after.vault!.STRIPE_KEY!.rotate = "30d";
    after.channels!["order-confirmed"]!.from = "x@y.z";
    after.channels!["order-confirmed"]!.locales = ["en"]; // remove none, metadata-ish
    delete after.channels!["order-confirmed"]!.locales;
    after.channels!["order-confirmed"]!.locales = ["fr"]; // remove en, add fr
    after.plugins!.audit!.origin = "community";
    after.stores!.db!.classifications = { email: { pii: true, retain: "1y" } };
    after.stores!.db!.tables!.orders!.columns = {
      email: { pii: true, retain: "1y" },
    };
    after.stores!.db!.buckets = ["b", "a"];
    after.stores!.db!.indexes = ["ix", "iy"];
    after.stores!.db!.namespaces = ["ns"];

    after.ai!.models!.smart = { provider: "anthropic", tier: "sonnet" };
    after.ai!.prompts!.triage = {
      version: 1,
      evals: "./evals/t2.jsonl",
      budget: { maxCostPerCall: 0.01 },
      in: { type: "string" },
      out: { type: "string" },
    };
    after.ai!.agents!.support = {
      tools: ["orders.create"],
      maxSteps: 2,
      budget: { maxCostPerRun: 0.5 },
    };

    after.drivers = { prod: ["redis", "postgres", "s3"], staging: ["postgres"] };
    delete after.drivers.dev;
    after.tenancy = { isolation: "database" };
    after.i18n = {
      locales: ["en", "de"],
      default: "de",
      dir: { en: "ltr", de: "ltr" },
    };
    after.topology = "monolith";
    after.clocks!.nightly!.timezone = "UTC";
    after.clocks!.nightly!.overridable = true;

    before.flows!["reports.export"]!.slo = {
      availability: "99.0%",
      latency: { p99: "100ms" },
    };
    after.flows!["reports.export"]!.slo = {
      availability: "99.9%",
      latency: { p99: "100ms" },
    };

    const result = diffManifest(before, after);
    expect(result.changes.length).toBeGreaterThan(10);
    expect(categoriesOf(result.changes).length).toBeGreaterThan(1);
  });

  test("schema add/remove roles and journey flow-only widen", async () => {
    const before = await loadBase();
    delete before.flows!["orders.create"]!.in;
    before.flows!["orders.create"]!.out = { type: "object" };
    before.journeys = {
      checkout: { flows: ["orders.create"], composes: "99%" },
    };
    const after = clone(before);
    after.flows!["orders.create"]!.in = { type: "object" };
    delete after.flows!["orders.create"]!.out;
    after.journeys!.checkout!.flows = ["orders.create", "reports.export"];
    after.journeys!.checkout!.composes = "99.5%";
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "contract-breaking", "/in")).toBe(true);
    expect(hasCategory(result.changes, "contract-breaking", "/out")).toBe(true);
    expect(hasCategory(result.changes, "no-impact", "composes")).toBe(true);
  });

  test("gate scopes widen path and plugin declares-only widen", async () => {
    const before = await loadBase();
    before.gates!.member = { kind: "policy", scopes: ["a"] };
    const after = clone(before);
    after.gates!.member = { kind: "policy", scopes: ["a", "b"] };
    after.plugins!.audit!.declares = ["consolePanel:audit", "cli:x"];
    const result = diffManifest(before, after);
    expect(hasCategory(result.changes, "permission-widening")).toBe(true);
  });

  test("invalid rate gate strings are ignored in widen detection", async () => {
    const before = await loadBase();
    before.flows!["orders.create"]!.gates = ["member", "rate:broken"];
    const after = clone(before);
    after.flows!["orders.create"]!.gates = ["member", "rate:also-broken"];
    const result = diffManifest(before, after);
    expect(result.changes.some((c) => c.summary.includes("rate limit widened"))).toBe(false);
  });

  test("slo added and removed; channel metadata; agent budget; drivers reorder; i18n add/dir", async () => {
    const before = await loadBase();
    delete before.flows!["orders.create"]!.slo;
    before.flows!["reports.export"]!.slo = { availability: "99.9%" };
    before.channels!["order-confirmed"] = {
      medium: "email",
      locales: ["en"],
      from: "a@b.c",
      schema: { type: "object" },
    };
    before.ai!.agents!.support = {
      tools: ["orders.create"],
      maxSteps: 3,
      budget: { maxCostPerRun: 1 },
    };
    before.drivers = { prod: ["postgres", "redis"] };
    delete before.i18n;
    before.stores!.db!.namespaces = ["a", "b"];
    before.stores!.db!.buckets = ["old"];

    const after = clone(before);
    after.flows!["orders.create"]!.slo = { availability: "99.5%" };
    delete after.flows!["reports.export"]!.slo;
    after.channels!["order-confirmed"]!.from = "z@z.z";
    after.ai!.agents!.support!.budget = { maxCostPerRun: 2 };
    after.drivers = { prod: ["redis", "postgres"] };
    after.i18n = { locales: ["en"], default: "en", dir: { en: "ltr" } };
    after.stores!.db!.namespaces = ["b"]; // remove a
    after.stores!.db!.buckets = ["new"]; // remove old, add new

    const mid = clone(after);
    mid.i18n = { locales: ["en"], default: "en", dir: { en: "rtl" } };

    const r1 = diffManifest(before, after);
    expect(hasCategory(r1.changes, "no-impact", "/slo")).toBe(true);
    expect(hasCategory(r1.changes, "contract-breaking", "/slo")).toBe(true);
    expect(hasCategory(r1.changes, "no-impact", "channels")).toBe(true);
    expect(hasCategory(r1.changes, "effect-widening", "budget")).toBe(true);
    expect(hasCategory(r1.changes, "no-impact", "drivers")).toBe(true);
    expect(hasCategory(r1.changes, "no-impact", "/i18n")).toBe(true);
    expect(hasCategory(r1.changes, "contract-breaking", "namespaces")).toBe(true);

    const r2 = diffManifest(after, mid);
    expect(hasCategory(r2.changes, "no-impact", "/i18n/dir")).toBe(true);
  });

  test("latency not loosened and isPii false paths", () => {
    expect(
      __test__.schemaBreaksClients(
        {
          type: "object",
          properties: {
            format: { type: "string", enum: ["csv", "json"] },
            note: { description: "x" },
          },
        },
        {
          type: "object",
          properties: {
            format: { type: "string", enum: ["csv", "json", "xml"] },
            note: { description: "y" },
          },
        },
        "in",
      ),
    ).toBe(false);

    expect(
      __test__.classificationWeakened({ a: "plain", b: 1, c: null }, { a: "plain", b: 1, c: null }),
    ).toBe(false);

    expect(__test__.latencyLoosened({ p99: "200ms" }, { p99: "100ms" })).toBe(false);
    expect(__test__.latencyLoosened(undefined, { p99: "100ms" })).toBe(false);
    expect(__test__.latencyLoosened({ p99: "200ms" }, { p50: "100ms" })).toBe(false);
    expect(__test__.latencyLoosened({ p99: "nope" }, { p99: "also" })).toBe(false);
  });
});
