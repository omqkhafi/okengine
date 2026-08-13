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
  projectStoresList,
  queryStore,
  tenancyDeclared,
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
    const bookings = db!.children.find((c) => c.name === "bookings");
    expect(bookings?.willNotFire.signals).toContain("order-placed");
    expect(bookings?.cache.producedByRead).toBe("computed:sql:bookings");
    expect(bookings?.piiColumns).toContain("email");
    expect(db!.replicaLagMs).toBe(120);
    expect(db!.migrationDrift?.drifted).toBe(false);

    const uploads = stores.find((s) => s.facet === "files");
    expect(uploads?.contentAddressed).toBe(true);
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
