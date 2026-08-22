/**
 * Console Store projection + preview dual-test (console §9.5).
 */

import { describe, expect, test } from "bun:test";
import { defineTable } from "../../elements/store.ts";
import { classify } from "../../elements/store/classify.ts";
import { DryRunWriteIsolationError, withDryRun } from "../../kernel/dry-run.ts";
import type { Manifest } from "../../manifest/types.ts";
import {
  createManifestStoreRuntime,
  editStore,
  isKnownConsoleSqlGate,
  isStoreSqlWrite,
  projectStoresList,
  getStoreFile,
  queryStore,
  runStoreSql,
  tenancyDeclared,
  tenancyEnabled,
  willNotFireFor,
} from "./store.ts";

const MANIFEST: Manifest = {
  oke: "1.0",
  app: "store-console-test",
  tenancy: { isolation: "row" },
  flows: {
    "bookings.create": {
      trigger: { http: { method: "POST", path: "/bookings" } },
      effects: {
        reads: ["sql:bookings"],
        writes: ["sql:bookings"],
        emits: ["order-placed"],
      },
    },
    "fulfillment.onOrder": {
      trigger: { signal: "order-placed" },
      effects: {
        writes: ["sql:shipments"],
        sends: ["booking-confirmed"],
      },
    },
  },
  signals: {
    "order-placed": { delivery: "once", retries: 3, deadLetter: true },
  },
  stores: {
    db: {
      facet: "sql",
      tables: {
        bookings: {
          columns: { email: { pii: true } },
        },
        shipments: {},
      },
    },
    sessions: { facet: "kv" },
    uploads: { facet: "files" },
    docs: { facet: "index" },
  },
  channels: {
    "booking-confirmed": { medium: "email", locales: ["en"] },
  },
};

const MANIFEST_NO_TENANCY: Manifest = {
  ...MANIFEST,
  tenancy: undefined,
  app: "notes-shaped",
};

describe("tenancyDeclared", () => {
  test("true only when manifest.tenancy is set", () => {
    expect(tenancyDeclared(MANIFEST)).toBe(true);
    expect(tenancyDeclared(MANIFEST_NO_TENANCY)).toBe(false);
    expect(tenancyDeclared(null)).toBe(false);
  });
});

describe("projectStoresList", () => {
  test("groups facets and surfaces will-not-fire from effects", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const {
      stores,
      tenancyDeclared: tenancy,
      tenants,
    } = await projectStoresList({
      manifest: MANIFEST,
      runtime,
      declaredFingerprint: "decl",
      appliedFingerprint: "decl",
      runs: [
        {
          flow: "bookings.mine",
          replicaLagMs: 120,
          tenant: "t1",
          effects: [{ kind: "read", resource: "sql:bookings" } as never],
        },
      ],
    });

    expect(tenancy).toBe(true);
    expect(tenants).toContain("t1");
    const db = stores.find((s) => s.ref === "sql:db");
    expect(db).toBeDefined();
    expect(db!.children.map((c) => c.name)).toEqual([
      "bookings",
      "shipments",
      "indexes",
      "functions",
      "triggers",
      "extensions",
      "policies",
    ]);
    expect(db!.children.find((c) => c.name === "indexes")?.kind).toBe("index");
    const bookings = db!.children.find((c) => c.name === "bookings");
    expect(bookings?.willNotFire.signals).toContain("order-placed");
    expect(bookings?.cache.producedByRead).toBe("computed:sql:bookings");
    expect(bookings?.piiColumns).toContain("email");
    expect(db!.replicaLagMs).toBe(120);
    expect(db!.migrationDrift?.drifted).toBe(false);

    const uploads = stores.find((s) => s.facet === "files");
    expect(uploads?.contentAddressed).toBe(true);
    expect(uploads?.driverId).toBe("memory");
    expect(uploads?.children[0]?.kind).toBeUndefined();
  });

  test("KV namespaces get distinct effectRefs so browse selection is unique", async () => {
    const { stores } = await projectStoresList({
      manifest: {
        oke: "1.0",
        app: "kv-ns",
        stores: {
          cache: { facet: "kv", namespaces: ["drafts", "triage-snooze"] },
        },
      },
      runtime: null,
      declaredFingerprint: "x",
      appliedFingerprint: null,
    });
    const cache = stores.find((s) => s.ref === "kv:cache");
    expect(cache?.children.map((c) => c.effectRef)).toEqual(["kv:drafts", "kv:triage-snooze"]);
  });

  test("no tenancy → empty tenants, flag false", async () => {
    const { tenancyDeclared: tenancy, tenants } = await projectStoresList({
      manifest: MANIFEST_NO_TENANCY,
      runtime: null,
      declaredFingerprint: "x",
      appliedFingerprint: null,
    });
    expect(tenancy).toBe(false);
    expect(tenants).toEqual([]);
  });

  test("tenancy.enabled uses registry ids, not historical run strings", async () => {
    expect(tenancyEnabled({ ...MANIFEST, tenancy: { isolation: "row", enabled: true } })).toBe(
      true,
    );
    const { tenants } = await projectStoresList({
      manifest: { ...MANIFEST, tenancy: { isolation: "row", enabled: true } },
      runtime: null,
      declaredFingerprint: "x",
      appliedFingerprint: null,
      tenantIds: ["acme"],
      runs: [{ flow: "x", tenant: "ghost-from-history" } as never],
    });
    expect(tenants).toEqual(["acme"]);
    expect(tenants).not.toContain("ghost-from-history");
  });
});

describe("willNotFireFor", () => {
  test("reads emits and sends from writer flows — does not guess", () => {
    const w = willNotFireFor(MANIFEST, ["fulfillment.onOrder"]);
    expect(w.channels).toEqual(["booking-confirmed"]);
    expect(w.signals).toEqual([]);
  });
});

describe("index driver resolution", () => {
  test("console manifest runtime uses the shared boot switch (memory default)", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const decl = runtime.declarations.get("index:docs");
    expect(decl).toBeDefined();
    const handle = (await runtime.open(decl!, {
      effects: { reads: ["index:docs"], writes: ["index:docs"] },
    })) as import("../../elements/store.ts").VectorIndexStoreFxHandle;
    expect(handle.driverId).toBe("memory");
    await handle.upsert("d1", [1, 0, 0], { t: 1 });
    const hits = await handle.search([1, 0, 0], 1);
    expect(hits[0]?.id).toBe("d1");
    expect(hits[0]?.meta).toEqual({ t: 1 });
    await runtime.close();
  });
});

describe("queryStore index", () => {
  test("lists documents and ranks a human query", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const handle = (await runtime.openRef("index:docs", {
      effects: { writes: ["index:docs"] },
    })) as import("../../elements/store.ts").VectorIndexStoreFxHandle;
    await handle.upsert("iss_eng_184", [1, 0, 0], {
      identifier: "ENG-184",
      title: "Pulse graph on selected trace",
    });
    await handle.upsert("iss_sup_12", [0, 1, 0], {
      identifier: "SUP-12",
      title: "Customer cannot sign in",
    });

    const listed = await queryStore(runtime, MANIFEST, { ref: "index:docs", limit: 50 });
    expect(listed.hits?.map((hit) => hit.id).sort()).toEqual(["iss_eng_184", "iss_sup_12"]);

    const text = await queryStore(runtime, MANIFEST, {
      ref: "index:docs",
      q: "pulse graph",
      topK: 5,
    });
    expect(text.hits?.[0]?.id).toBe("iss_eng_184");

    const probe = await queryStore(runtime, MANIFEST, {
      ref: "index:docs",
      vector: [1, 0, 0],
      topK: 1,
    });
    expect(probe.hits?.[0]?.id).toBe("iss_eng_184");
    await runtime.close();
  });
});

describe("PII masking survives SELECT *", () => {
  test("masks classified columns; reveal returns cleartext", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const bookings = defineTable("bookings", {
      id: true,
      email: classify({ pii: true }),
      seats: true,
    });
    // Re-register sql with schema so classifications apply.
    const { sql: declareSql } = await import("../../elements/store.ts");
    runtime.register(
      declareSql("db", {
        schema: { bookings },
        classify: { bookings: { email: { pii: true } } },
      }),
    );
    const handle = await runtime.openRef("sql:db", {
      effects: { writes: ["sql:db"] },
      revealPii: true,
    });
    const sql = handle as import("../../elements/store.ts").SqlStoreHandle;
    await sql.ensureTable(bookings);
    await sql.insert(bookings).values({
      id: "b1",
      email: "secret@example.com",
      seats: 2,
    });

    const masked = await queryStore(runtime, MANIFEST, {
      ref: "sql:db",
      child: "bookings",
      revealPii: false,
    });
    expect(masked.rows?.[0]?.email).toBe("[redacted]");
    expect(masked.masked).toBe(true);

    const clear = await queryStore(runtime, MANIFEST, {
      ref: "sql:db",
      child: "bookings",
      revealPii: true,
    });
    expect(clear.rows?.[0]?.email).toBe("secret@example.com");
  });

  test("browse masks owner_email / ownerEmail unless revealPii", async () => {
    const { field, sql: declareSql, store } = await import("../../elements/store.ts");
    const views = store.schema.table("views", {
      id: field.text().primaryKey(),
      ownerEmail: field.text().pii(),
    });
    const manifest: Manifest = {
      oke: "1.0",
      app: "pii-alias-browse",
      stores: {
        db: {
          facet: "sql",
          tables: {
            views: {
              columns: {
                ownerEmail: { type: "text", pii: true, sqlName: "owner_email" },
              },
            },
          },
        },
      },
    };
    const runtime = await createManifestStoreRuntime(manifest);
    runtime.register(
      declareSql("db", {
        schema: { views },
        classify: { views: { ownerEmail: { pii: true } } },
      }),
    );
    const sql = (await runtime.openRef("sql:db", {
      effects: { writes: ["sql:db"] },
      revealPii: true,
    })) as import("../../elements/store.ts").SqlStoreHandle;
    await sql.ensureTable(views);
    await sql.insert(views).values({ id: "view_web_board", ownerEmail: "aria@keel.dev" });

    const { stores } = await projectStoresList({
      manifest,
      runtime,
      declaredFingerprint: "x",
      appliedFingerprint: "x",
    });
    const child = stores.find((s) => s.ref === "sql:db")?.children.find((c) => c.name === "views");
    expect(child?.piiColumns).toContain("ownerEmail");
    expect(child?.piiColumns).toContain("owner_email");

    const masked = await queryStore(runtime, manifest, { ref: "sql:db", child: "views" });
    expect(masked.masked).toBe(true);
    expect(masked.rows?.[0]?.owner_email ?? masked.rows?.[0]?.ownerEmail).toBe("[redacted]");

    const clear = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "views",
      revealPii: true,
    });
    expect(clear.masked).toBe(false);
    expect(clear.rows?.[0]?.owner_email ?? clear.rows?.[0]?.ownerEmail).toBe("aria@keel.dev");

    // A prior reveal open on this runtime must not leave browse unmasked.
    const afterReveal = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "views",
    });
    expect(afterReveal.masked).toBe(true);
    expect(afterReveal.rows?.[0]?.owner_email ?? afterReveal.rows?.[0]?.ownerEmail).toBe(
      "[redacted]",
    );
    await runtime.close();
  });

  test("edit rejects PII mask placeholder over classified column", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const bookings = defineTable("bookings", {
      id: true,
      email: classify({ pii: true }),
      seats: true,
    });
    const { sql: declareSql } = await import("../../elements/store.ts");
    runtime.register(
      declareSql("db", {
        schema: { bookings },
        classify: { bookings: { email: { pii: true } } },
      }),
    );
    const sql = (await runtime.openRef("sql:db", {
      effects: { writes: ["sql:db"] },
      revealPii: true,
    })) as import("../../elements/store.ts").SqlStoreHandle;
    await sql.ensureTable(bookings);
    await sql.insert(bookings).values({ id: "b1", email: "secret@example.com", seats: 2 });

    await expect(
      editStore(
        runtime,
        MANIFEST,
        { ref: "sql:db", child: "bookings", id: "b1", patch: { email: "[redacted]" } },
        { production: false, dryRun: false },
      ),
    ).rejects.toThrow(/PII mask placeholder/);

    const after = await queryStore(runtime, MANIFEST, {
      ref: "sql:db",
      child: "bookings",
      revealPii: true,
    });
    expect(after.rows?.[0]?.email).toBe("secret@example.com");
  });
});

describe("editStore SQL apply", () => {
  test("commits a column patch through memory SQL", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const bookings = defineTable("bookings", {
      id: true,
      flight_id: true,
      seats: true,
    });
    const { sql: declareSql } = await import("../../elements/store.ts");
    runtime.register(declareSql("db", { schema: { bookings } }));
    const sql = (await runtime.openRef("sql:db", {
      effects: { writes: ["sql:db"] },
    })) as import("../../elements/store.ts").SqlStoreHandle;
    await sql.ensureTable(bookings);
    await sql.insert(bookings).values({ id: "b1", flight_id: "SK-119", seats: 2 });

    const result = await editStore(
      runtime,
      MANIFEST,
      { ref: "sql:db", child: "bookings", id: "b1", patch: { flight_id: "SK-999" } },
      { production: false, dryRun: false },
    );
    expect(result.applied).toBe(true);
    expect(result.dryRun).toBe(false);

    const after = await queryStore(runtime, MANIFEST, {
      ref: "sql:db",
      child: "bookings",
      revealPii: true,
    });
    expect(after.rows?.[0]?.flight_id).toBe("SK-999");
  });

  test("inserts a row when id is omitted and patch includes id", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const bookings = defineTable("bookings", {
      id: true,
      flight_id: true,
      seats: true,
    });
    const { sql: declareSql } = await import("../../elements/store.ts");
    runtime.register(declareSql("db", { schema: { bookings } }));
    const sql = (await runtime.openRef("sql:db", {
      effects: { writes: ["sql:db"] },
    })) as import("../../elements/store.ts").SqlStoreHandle;
    await sql.ensureTable(bookings);

    const result = await editStore(
      runtime,
      MANIFEST,
      {
        ref: "sql:db",
        child: "bookings",
        patch: { id: "b2", flight_id: "SK-200", seats: 4 },
      },
      { production: false, dryRun: false },
    );
    expect(result.applied).toBe(true);

    const after = await queryStore(runtime, MANIFEST, {
      ref: "sql:db",
      child: "bookings",
      revealPii: true,
    });
    expect(after.rows).toEqual([{ id: "b2", flight_id: "SK-200", seats: 4 }]);
  });

  test("dry-run insert does not persist the row", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const bookings = defineTable("bookings", {
      id: true,
      flight_id: true,
      seats: true,
    });
    const { sql: declareSql } = await import("../../elements/store.ts");
    runtime.register(declareSql("db", { schema: { bookings } }));
    const sql = (await runtime.openRef("sql:db", {
      effects: { writes: ["sql:db"] },
    })) as import("../../elements/store.ts").SqlStoreHandle;
    await sql.ensureTable(bookings);

    const preview = await editStore(
      runtime,
      MANIFEST,
      {
        ref: "sql:db",
        child: "bookings",
        patch: { id: "b-dry", flight_id: "SK-1", seats: 1 },
      },
      { production: false, dryRun: true },
    );
    expect(preview.applied).toBe(false);
    expect(preview.dryRun).toBe(true);

    const after = await queryStore(runtime, MANIFEST, {
      ref: "sql:db",
      child: "bookings",
      revealPii: true,
    });
    expect(after.rows ?? []).toEqual([]);
  });

  test("refuses insert without patch.id", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const bookings = defineTable("bookings", { id: true, seats: true });
    const { sql: declareSql } = await import("../../elements/store.ts");
    runtime.register(declareSql("db", { schema: { bookings } }));
    const sql = (await runtime.openRef("sql:db", {
      effects: { writes: ["sql:db"] },
    })) as import("../../elements/store.ts").SqlStoreHandle;
    await sql.ensureTable(bookings);

    await expect(
      editStore(
        runtime,
        MANIFEST,
        { ref: "sql:db", child: "bookings", patch: { seats: 2 } },
        { production: false, dryRun: false },
      ),
    ).rejects.toThrow("sql insert requires an id in the patch");
  });
});

describe("queryStore SQL catalog", () => {
  test("indexes fall back to Manifest primaryKey / unique; extensions list and toggle", async () => {
    const manifest = {
      ...MANIFEST,
      stores: {
        ...MANIFEST.stores,
        db: {
          facet: "sql" as const,
          tables: {
            bookings: {
              columns: {
                id: { type: "text" as const, primaryKey: true },
                email: { type: "text" as const, unique: true, pii: true },
              },
            },
          },
        },
      },
    };
    const runtime = await createManifestStoreRuntime(manifest);
    const indexes = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "indexes",
    });
    expect(indexes.rows?.map((r) => r.name)).toEqual(["bookings_email_key", "bookings_pkey"]);
    expect(indexes.masked).toBe(false);
    const indexesAlias = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "__indexes",
    });
    expect(indexesAlias.rows?.map((r) => r.name)).toEqual(indexes.rows?.map((r) => r.name));

    const functions = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "functions",
    });
    expect(functions.rows).toEqual([]);

    const triggers = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "triggers",
    });
    expect(triggers.rows).toEqual([]);

    const policies = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "policies",
    });
    expect(policies.rows).toEqual([]);

    await editStore(
      runtime,
      manifest,
      {
        ref: "sql:db",
        child: "policies",
        id: "bookings:read_all",
        patch: {
          create: true,
          name: "read_all",
          table: "bookings",
          command: "SELECT",
          behavior: "PERMISSIVE",
          roles: "public",
          using: "true",
          enableRls: true,
        },
      },
      { production: false, dryRun: false },
    );
    const withPolicy = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "policies",
    });
    expect(withPolicy.rows?.find((r) => r.name === "read_all")).toMatchObject({
      table: "bookings",
      command: "SELECT",
      roles: "public",
      using: "true",
    });

    const listedOn = await projectStoresList({
      manifest,
      runtime,
      declaredFingerprint: "x",
      appliedFingerprint: "x",
    });
    const listedBookings = listedOn.stores
      .find((s) => s.ref === "sql:db")
      ?.children.find((c) => c.name === "bookings");
    expect(listedBookings?.rls).toBe(true);
    expect(listedBookings?.rlsPolicyCount).toBe(1);

    await editStore(
      runtime,
      manifest,
      {
        ref: "sql:db",
        child: "policies",
        id: "bookings:read_all",
        patch: { using: "false", roles: "public" },
      },
      { production: false, dryRun: false },
    );
    const altered = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "policies",
    });
    expect(altered.rows?.find((r) => r.name === "read_all")).toMatchObject({
      using: "false",
      roles: "public",
    });

    await editStore(
      runtime,
      manifest,
      {
        ref: "sql:db",
        child: "policies",
        id: "bookings:read_all",
        patch: { drop: true },
      },
      { production: false, dryRun: false },
    );
    const afterDrop = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "policies",
    });
    expect(afterDrop.rows?.find((r) => r.name === "read_all")).toBeUndefined();

    const extensions = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "extensions",
    });
    expect(extensions.rows?.some((r) => r.name === "plpgsql" && r.enabled === true)).toBe(true);
    expect(extensions.rows?.some((r) => r.name === "vector" && r.enabled === false)).toBe(true);
    expect(extensions.rows?.some((r) => r.name === "timescaledb")).toBe(false);
    expect(extensions.rows?.find((r) => r.name === "plpgsql")?.source).toBe("builtin");
    expect(extensions.rows?.find((r) => r.name === "plpgsql")?.title).toBe("PL/pgSQL");
    expect(extensions.rows?.find((r) => r.name === "amcheck")?.title).toBe("AM Check");
    expect(extensions.rows?.find((r) => r.name === "vector")).toMatchObject({
      title: "pgvector",
      version: "0.8.0",
      available: "0.8.6",
      upgrade: true,
      url: "https://github.com/pgvector/pgvector",
    });

    await editStore(
      runtime,
      manifest,
      { ref: "sql:db", child: "extensions", id: "timescaledb", patch: { enabled: true } },
      { production: false, dryRun: false },
    );
    const withTs = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "extensions",
    });
    expect(withTs.rows?.find((r) => r.name === "timescaledb")).toMatchObject({
      enabled: true,
      source: "library",
    });

    await editStore(
      runtime,
      manifest,
      { ref: "sql:db", child: "extensions", id: "vector", patch: { enabled: true } },
      { production: false, dryRun: false },
    );
    const after = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "extensions",
    });
    expect(after.rows?.find((r) => r.name === "vector")?.enabled).toBe(true);

    await editStore(
      runtime,
      manifest,
      { ref: "sql:db", child: "extensions", id: "vector", patch: { enabled: false } },
      { production: false, dryRun: false },
    );
    const off = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "extensions",
    });
    expect(off.rows?.find((r) => r.name === "vector")?.enabled).toBe(false);

    await editStore(
      runtime,
      manifest,
      { ref: "sql:db", child: "extensions", id: "vector", patch: { upgrade: true } },
      { production: false, dryRun: false },
    );
    const vectorUp = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "extensions",
    });
    expect(vectorUp.rows?.find((r) => r.name === "vector")).toMatchObject({
      enabled: true,
      version: "0.8.6",
      available: "0.8.6",
      upgrade: false,
    });

    await editStore(
      runtime,
      manifest,
      { ref: "sql:db", child: "extensions", id: "amcheck", patch: { enabled: true } },
      { production: false, dryRun: false },
    );
    const stale = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "extensions",
    });
    expect(stale.rows?.find((r) => r.name === "amcheck")).toMatchObject({
      enabled: true,
      version: "1.3",
      available: "1.4",
      upgrade: true,
    });

    const preview = await editStore(
      runtime,
      manifest,
      { ref: "sql:db", child: "extensions", id: "amcheck", patch: { upgrade: true } },
      { production: false, dryRun: true },
    );
    expect(preview.applied).toBe(false);
    const afterPreview = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "extensions",
    });
    expect(afterPreview.rows?.find((r) => r.name === "amcheck")).toMatchObject({
      version: "1.3",
      upgrade: true,
    });

    await editStore(
      runtime,
      manifest,
      { ref: "sql:db", child: "extensions", id: "amcheck", patch: { upgrade: true } },
      { production: false, dryRun: false },
    );
    const upgraded = await queryStore(runtime, manifest, {
      ref: "sql:db",
      child: "extensions",
    });
    expect(upgraded.rows?.find((r) => r.name === "amcheck")).toMatchObject({
      enabled: true,
      version: "1.4",
      available: "1.4",
      upgrade: false,
    });
    await runtime.close();
  });
});

describe("queryStore KV metadata", () => {
  test("kv browse returns remaining TTL and serialized size", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const { kv: declareKv } = await import("../../elements/store.ts");
    runtime.register(declareKv("sessions"));
    const kv = (await runtime.openRef("kv:sessions", {
      effects: { writes: ["kv:sessions"] },
    })) as import("../../elements/store.ts").KvStoreFxHandle;
    await kv.set("drafts:a", { n: 1 }, "1h");
    await kv.set("drafts:b", { n: 2 });

    const result = await queryStore(runtime, MANIFEST, {
      ref: "kv:sessions",
      child: "drafts",
    });
    const withTtl = result.keys?.find((e) => e.key === "drafts:a");
    const noTtl = result.keys?.find((e) => e.key === "drafts:b");
    expect(withTtl?.ttlMs).toBeGreaterThan(3_000_000);
    expect(withTtl?.sizeBytes).toBeGreaterThan(0);
    expect(noTtl?.ttlMs).toBeNull();
    expect(noTtl?.sizeBytes).toBeGreaterThan(0);
  });

  test("singleton kv store lists root keys, not child: prefix", async () => {
    const runtime = await createManifestStoreRuntime({
      oke: "1.0",
      app: "keel",
      stores: { drafts: { facet: "kv", namespaces: ["drafts"] } },
    });
    const { kv: declareKv } = await import("../../elements/store.ts");
    runtime.register(declareKv("drafts"));
    const kv = (await runtime.openRef("kv:drafts", {
      effects: { writes: ["kv:drafts"] },
    })) as import("../../elements/store.ts").KvStoreFxHandle;
    await kv.set("ENG-184", { title: "Pulse graph" }, "2h");

    const result = await queryStore(
      runtime,
      { oke: "1.0", app: "keel" },
      {
        ref: "kv:drafts",
        child: "drafts",
      },
    );
    expect(result.keys?.map((e) => e.key)).toEqual(["ENG-184"]);
    await runtime.close();
  });

  test("kv edit can set, preserve, and clear TTL; add creates a key", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const { kv: declareKv } = await import("../../elements/store.ts");
    runtime.register(declareKv("sessions"));
    const kv = (await runtime.openRef("kv:sessions", {
      effects: { writes: ["kv:sessions"] },
    })) as import("../../elements/store.ts").KvStoreFxHandle;
    await kv.set("drafts:a", { n: 1 }, "1h");

    await editStore(
      runtime,
      MANIFEST,
      { ref: "kv:sessions", key: "drafts:a", patch: { value: { n: 2 } } },
      { production: false, dryRun: false },
    );
    expect(await kv.get("drafts:a")).toEqual({ n: 2 });
    expect(await kv.ttlMs("drafts:a")).toBeGreaterThan(3_000_000);

    await editStore(
      runtime,
      MANIFEST,
      { ref: "kv:sessions", key: "drafts:a", patch: { ttl: "10m" } },
      { production: false, dryRun: false },
    );
    const afterTtl = await kv.ttlMs("drafts:a");
    expect(afterTtl).toBeGreaterThan(8 * 60_000);
    expect(afterTtl).toBeLessThanOrEqual(10 * 60_000);

    await editStore(
      runtime,
      MANIFEST,
      { ref: "kv:sessions", key: "drafts:a", patch: { ttl: null } },
      { production: false, dryRun: false },
    );
    expect(await kv.ttlMs("drafts:a")).toBeNull();

    await editStore(
      runtime,
      MANIFEST,
      { ref: "kv:sessions", key: "drafts:new", patch: { value: { ok: true }, ttl: "30m" } },
      { production: false, dryRun: false },
    );
    expect(await kv.get("drafts:new")).toEqual({ ok: true });
    expect(await kv.ttlMs("drafts:new")).toBeGreaterThan(20 * 60_000);
  });
});

describe("queryStore files + object get/put", () => {
  test("files browse returns sizeBytes; get and put round-trip", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const { files: declareFiles } = await import("../../elements/store.ts");
    runtime.register(declareFiles("uploads"));
    const files = (await runtime.openRef("files:uploads", {
      effects: { writes: ["files:uploads"] },
    })) as import("../../elements/store.ts").FilesStoreFxHandle;
    await files.put("docs/readme.txt", "hello files");

    const listed = await queryStore(runtime, MANIFEST, { ref: "files:uploads" });
    expect(listed.facet).toBe("files");
    expect(listed.keys?.[0]?.key).toBe("docs/readme.txt");
    expect(listed.keys?.[0]?.sizeBytes).toBeGreaterThan(0);

    const got = await getStoreFile(runtime, { ref: "files:uploads", key: "docs/readme.txt" });
    expect(got.encoding).toBe("utf8");
    expect(got.body).toBe("hello files");
    expect(got.contentType).toBe("text/plain");
    expect(got.truncated).toBe(false);

    await editStore(
      runtime,
      MANIFEST,
      {
        ref: "files:uploads",
        key: "docs/readme.txt",
        patch: { body: "updated", encoding: "utf8" },
      },
      { production: false, dryRun: false },
    );
    expect(new TextDecoder().decode((await files.get("docs/readme.txt"))!)).toBe("updated");

    const preview = await editStore(
      runtime,
      MANIFEST,
      {
        ref: "files:uploads",
        key: "docs/new.txt",
        patch: { body: "dry", encoding: "utf8" },
      },
      { production: false, dryRun: true },
    );
    expect(preview.dryRun).toBe(true);
    expect(await files.get("docs/new.txt")).toBeNull();

    await editStore(
      runtime,
      MANIFEST,
      {
        ref: "files:uploads",
        key: "docs/رخصة عمل.pdf",
        patch: { body: "pdf-bytes", encoding: "utf8", originalName: "رخصة عمل.pdf" },
      },
      { production: false, dryRun: false },
    );
    const afterPut = await queryStore(runtime, MANIFEST, { ref: "files:uploads" });
    const written = afterPut.keys?.find((k) => k.originalName === "رخصة عمل.pdf");
    expect(written?.key).toBeDefined();
    expect(written?.key.includes("رخصة")).toBe(false);
    expect(written?.key.endsWith(".pdf")).toBe(true);
    expect(await files.get("docs/رخصة عمل.pdf")).toBeNull();
    expect(afterPut.keys?.some((k) => k.key === ".oke/catalog.json")).toBe(false);

    const gotNamed = await getStoreFile(runtime, { ref: "files:uploads", key: written!.key });
    expect(gotNamed.originalName).toBe("رخصة عمل.pdf");

    const dryUnsafe = await editStore(
      runtime,
      MANIFEST,
      {
        ref: "files:uploads",
        key: "docs/вложения.png",
        patch: { body: "x", encoding: "utf8", originalName: "вложения.png" },
      },
      { production: false, dryRun: true },
    );
    expect(dryUnsafe.dryRun).toBe(true);
    const afterDry = await files.list("");
    expect(
      afterDry.some((k) => k.includes("вложения") || /docs\/file-[0-9a-f]{8}\.png$/.test(k)),
    ).toBe(false);
    await runtime.close();
  });
});

describe("runStoreSql", () => {
  test("accepts trailing semicolon and multiline SELECT", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const bookings = defineTable("bookings", {
      id: true,
      seats: true,
    });
    const { sql: declareSql } = await import("../../elements/store.ts");
    runtime.register(declareSql("db", { schema: { bookings } }));
    const sql = (await runtime.openRef("sql:db", {
      effects: { writes: ["sql:db"] },
    })) as import("../../elements/store.ts").SqlStoreHandle;
    await sql.ensureTable(bookings);
    await sql.insert(bookings).values({ id: "b1", seats: 2 });

    const result = await runStoreSql(runtime, "sql:db", `SELECT *\nFROM "bookings"\nLIMIT 50;`, {
      allowWrite: false,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.id).toBe("b1");
    await runtime.close();
  });

  test("runs INSERT / UPDATE / DELETE with SQL literals when allowWrite", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const bookings = defineTable("bookings", {
      id: true,
      seats: true,
    });
    const { sql: declareSql } = await import("../../elements/store.ts");
    runtime.register(declareSql("db", { schema: { bookings } }));
    const sql = (await runtime.openRef("sql:db", {
      effects: { writes: ["sql:db"] },
    })) as import("../../elements/store.ts").SqlStoreHandle;
    await sql.ensureTable(bookings);

    const inserted = await runStoreSql(
      runtime,
      "sql:db",
      `INSERT INTO "bookings" ("id", "seats") VALUES ('b2', 4);`,
      { allowWrite: true },
    );
    expect(inserted.rows[0]?.changes).toBe(1);

    const updated = await runStoreSql(
      runtime,
      "sql:db",
      `UPDATE "bookings" SET "seats" = 8 WHERE "id" = 'b2';`,
      { allowWrite: true },
    );
    expect(updated.rows[0]?.changes).toBe(1);

    const read = await runStoreSql(
      runtime,
      "sql:db",
      `SELECT * FROM "bookings" WHERE "id" = 'b2'`,
      {
        allowWrite: false,
      },
    );
    expect(read.rows[0]?.seats).toBe(8);

    const deleted = await runStoreSql(
      runtime,
      "sql:db",
      `DELETE FROM "bookings" WHERE "id" = 'b2';`,
      { allowWrite: true },
    );
    expect(deleted.rows[0]?.changes).toBe(1);
    await runtime.close();
  });

  test("isStoreSqlWrite matches DML, DDL, and EXPLAIN ANALYZE", () => {
    expect(isStoreSqlWrite("SELECT 1")).toBe(false);
    expect(isStoreSqlWrite("EXPLAIN SELECT 1")).toBe(false);
    expect(isStoreSqlWrite("EXPLAIN ANALYZE SELECT 1")).toBe(true);
    expect(isStoreSqlWrite("CREATE TABLE t (id text)")).toBe(true);
    expect(isStoreSqlWrite("GRANT SELECT ON t TO public")).toBe(true);
    expect(isStoreSqlWrite("ANALYZE t")).toBe(true);
  });

  test("refuses writes without allowWrite", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    await expect(
      runStoreSql(runtime, "sql:db", `DELETE FROM "bookings" WHERE "id" = 'x'`, {
        allowWrite: false,
      }),
    ).rejects.toThrow(/read-only/);
    await runtime.close();
  });

  test("DDL and EXPLAIN ANALYZE require allowWrite; EXPLAIN does not", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    await expect(
      runStoreSql(runtime, "sql:db", `CREATE TABLE t (id text)`, { allowWrite: false }),
    ).rejects.toThrow(/read-only/);
    await expect(
      runStoreSql(runtime, "sql:db", `GRANT SELECT ON t TO public`, { allowWrite: false }),
    ).rejects.toThrow(/read-only/);
    await expect(
      runStoreSql(runtime, "sql:db", `EXPLAIN ANALYZE SELECT 1`, { allowWrite: false }),
    ).rejects.toThrow(/read-only/);
    try {
      await runStoreSql(runtime, "sql:db", `EXPLAIN SELECT 1`, { allowWrite: false });
    } catch (err) {
      expect(String(err)).not.toMatch(/read-only/);
    }
    await runtime.close();
  });

  test("masks classified columns unless revealPii", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const bookings = defineTable("bookings", {
      id: true,
      email: classify({ pii: true }),
      seats: true,
    });
    const { sql: declareSql } = await import("../../elements/store.ts");
    runtime.register(
      declareSql("db", {
        schema: { bookings },
        classify: { bookings: { email: { pii: true } } },
      }),
    );
    const sql = (await runtime.openRef("sql:db", {
      effects: { writes: ["sql:db"] },
      revealPii: true,
    })) as import("../../elements/store.ts").SqlStoreHandle;
    await sql.ensureTable(bookings);
    await sql.insert(bookings).values({
      id: "b1",
      email: "secret@example.com",
      seats: 2,
    });

    const masked = await runStoreSql(runtime, "sql:db", `SELECT * FROM "bookings"`, {
      allowWrite: false,
    });
    expect(masked.rows[0]?.email).toBe("[redacted]");
    expect(masked.masked).toBe(true);

    const clear = await runStoreSql(runtime, "sql:db", `SELECT * FROM "bookings"`, {
      allowWrite: false,
      revealPii: true,
    });
    expect(clear.rows[0]?.email).toBe("secret@example.com");
    expect(clear.masked).toBe(false);
    await runtime.close();
  });

  test("asGate is accepted on memory but not applied", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const bookings = defineTable("bookings", {
      id: true,
      seats: true,
    });
    const { sql: declareSql } = await import("../../elements/store.ts");
    runtime.register(declareSql("db", { schema: { bookings } }));
    const sql = (await runtime.openRef("sql:db", {
      effects: { writes: ["sql:db"] },
    })) as import("../../elements/store.ts").SqlStoreHandle;
    await sql.ensureTable(bookings);
    await sql.insert(bookings).values({ id: "b1", seats: 2 });

    const result = await runStoreSql(runtime, "sql:db", `SELECT * FROM "bookings"`, {
      allowWrite: false,
      asGate: "public",
    });
    expect(result.asGate).toBe("public");
    expect(result.asUserId).toBeNull();
    expect(result.gateApplied).toBe(false);
    expect(result.rls.applied).toBe(false);
    expect(result.rows).toHaveLength(1);
    await runtime.close();
  });
});

describe("isKnownConsoleSqlGate", () => {
  test("allows public and policy gates; refuses rate and unknown", () => {
    const manifest: Manifest = {
      ...MANIFEST,
      gates: {
        public: { kind: "policy" },
        member: { kind: "policy" },
        "rate:api": { kind: "rate", max: 10, per: "1m" },
      },
    };
    expect(isKnownConsoleSqlGate(manifest, "public")).toBe(true);
    expect(isKnownConsoleSqlGate(manifest, "member")).toBe(true);
    expect(isKnownConsoleSqlGate(manifest, "rate:api")).toBe(false);
    expect(isKnownConsoleSqlGate(manifest, "missing")).toBe(false);
    expect(isKnownConsoleSqlGate(null, "public")).toBe(true);
    expect(isKnownConsoleSqlGate(null, "member")).toBe(false);
  });
});

describe("preview dual test (withDryRun)", () => {
  test("console.store.preview rolls back writes via snapshot + withDryRun", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const { kv: declareKv } = await import("../../elements/store.ts");
    runtime.register(declareKv("sessions"));
    const kv = (await runtime.openRef("kv:sessions", {
      effects: { writes: ["kv:sessions"] },
    })) as import("../../elements/store.ts").KvStoreFxHandle;
    await kv.set("qty", { n: 100 });

    // Mechanism: withDryRun stubs send/ask; editStore dry-run also snapshots
    // the target key and restores it so the write does not persist.
    const preview = await editStore(
      runtime,
      MANIFEST,
      {
        ref: "kv:sessions",
        key: "qty",
        patch: { value: { n: 50 } },
      },
      { production: false, dryRun: true },
    );
    expect(preview.dryRun).toBe(true);
    expect(preview.applied).toBe(false);
    expect(preview.wouldHaveFired).toEqual([]);
    expect(await kv.get("qty")).toEqual({ n: 100 });

    // Live edit persists.
    await editStore(
      runtime,
      MANIFEST,
      {
        ref: "kv:sessions",
        key: "qty",
        patch: { value: { n: 50 } },
      },
      { production: false, dryRun: false },
    );
    expect(await kv.get("qty")).toEqual({ n: 50 });
  });

  test("DryRunWriteIsolationError is the refusal signal", () => {
    const err = new DryRunWriteIsolationError("driver cannot isolate");
    expect(err.code).toBe("dry_run_write_isolation");
  });

  test("withDryRun intercepts send/ask (kernel dual half)", async () => {
    const { wouldHaveFired } = await withDryRun(async () => {
      const { recordWouldHaveFired } = await import("../../kernel/dry-run.ts");
      recordWouldHaveFired("send", "booking-confirmed");
    });
    expect(wouldHaveFired).toEqual([{ kind: "send", resource: "booking-confirmed" }]);
  });
});
