/**
 * `createTestApp` multi-tenancy testing & real RLS isolation.
 *
 * RLS policies / helper functions are installed by `oke db push` in real apps;
 * a test boot does not run migrations, so this harness test installs the
 * tenant policy + `oke.tenant()` helper on the booted PGlite connection
 * (mirroring `src/elements/store/sql-rls-isolation.test.ts`).
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import { gate } from "../elements/gate.ts";
import { field } from "../elements/store/schema-decl.ts";
import { store } from "../elements/store.ts";
import { installOkeRlsHelpers } from "../drivers/pg-rls.ts";
import type { SqlConnection } from "../drivers/types.ts";
import { createTestApp } from "./create-test-app.ts";

describe("createTestApp tenancy testing & RLS isolation", () => {
  test("loginAs with tenantId stamps fx.tenant.id and isolates queries via real RLS", async () => {
    resetBindings();
    resetFlowSeq();

    const memberGate = gate.policy("member", ({ auth }) => !!auth.userId && !!auth.verified);

    const documents = store.schema.table(
      "documents",
      {
        id: field.text().primaryKey(),
        tenant_id: field.text().notNull(),
        title: field.text().notNull(),
      },
      [store.schema.policy.tenant("tenant_id", { for: "all" })],
    );
    const docStore = store.sql("docs", { schema: { documents } });

    on(
      http.post("/docs").gate(memberGate),
      flow("docs.create", {
        in: z.object({ title: z.string() }),
        out: z.object({ id: z.string(), tenantId: z.string().nullable() }),
        effects: { writes: ["sql:docs"], reads: ["sql:docs"] },
        do: async (input, fx) => {
          const id = fx.id();
          await fx.store(docStore).insert(documents).values({
            id,
            tenant_id: fx.tenant.id!,
            title: input.title,
          });
          return { id, tenantId: fx.tenant.id };
        },
      }),
    );

    on(
      http.get("/docs").gate(memberGate),
      flow("docs.list", {
        in: z.void(),
        out: z.array(z.object({ id: z.string(), title: z.string() })),
        effects: { reads: ["sql:docs"] },
        do: async (_input, fx) => {
          const rows = await fx.store(docStore).select().from(documents);
          return rows.map((r) => ({ id: r.id, title: r.title }));
        },
      }),
    );

    const app = oke({
      name: "tenant-app",
      gate: {
        policies: [memberGate],
        auth: { tenant: true },
      },
      stores: [docStore],
      env: "test",
    });

    const t = await createTestApp(app, {
      gates: [memberGate],
      boot: {
        config: {
          drivers: {
            store: {
              sql: { test: "pglite" }, // Real PGlite RLS engine
            },
          },
        },
      },
    });

    const userAcme = await t.auth.loginAs({ id: "alice", tenantId: "acme" });
    const userGlobex = await t.auth.loginAs({ id: "bob", tenantId: "globex" });

    expect(userAcme.tenantId).toBe("acme");
    expect(userGlobex.tenantId).toBe("globex");

    // Install RLS helper functions + tenant policy on the booted connection.
    // Real deployments get these via `oke db push`; the harness boot does not
    // run migrations, so the test installs them explicitly (same as the
    // codebase's own sql-rls-isolation tests).
    const conn = (await app.bootResult?.store?.primarySql()) as SqlConnection | undefined;
    if (!conn) throw new Error("no primary sql connection");
    await conn.exec(`CREATE TABLE IF NOT EXISTS "documents" (
      id text PRIMARY KEY,
      tenant_id text NOT NULL,
      title text NOT NULL
    )`);
    await conn.exec(`ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY`);
    await installOkeRlsHelpers((sql) => conn.exec(sql));
    await conn.exec(
      `CREATE POLICY tenant_tenant_id_all ON "documents"
        AS PERMISSIVE FOR ALL TO public
        USING (tenant_id = oke.tenant())
        WITH CHECK (tenant_id = oke.tenant())`,
    );

// Alice creates document in Acme
    const createRes1 = await t.api.docs!.create!({ title: "Acme Roadmap" }, { as: userAcme });
    expect(createRes1.error).toBeNull();
    expect((createRes1.data as { tenantId: string | null }).tenantId).toBe("acme");

    // Bob creates document in Globex
    const createRes2 = await t.api.docs!.create!({ title: "Globex Secrets" }, { as: userGlobex });
    expect(createRes2.error).toBeNull();
    expect((createRes2.data as { tenantId: string | null }).tenantId).toBe("globex");

    // Alice lists docs -> should only see Acme
    const listAcme = await t.api.docs!.list!(undefined, { as: userAcme });
    expect(listAcme.error).toBeNull();
    expect(listAcme.data).toHaveLength(1);
    expect((listAcme.data as { title: string }[])[0]!.title).toBe("Acme Roadmap");

    // Bob lists docs -> should only see Globex
    const listGlobex = await t.api.docs!.list!(undefined, { as: userGlobex });
    expect(listGlobex.error).toBeNull();
    expect(listGlobex.data).toHaveLength(1);
    expect((listGlobex.data as { title: string }[])[0]!.title).toBe("Globex Secrets");

    // The `{ tenant }` call override re-scopes RLS even when it differs from the
    // principal's own `tenantId`. Carol belongs to Acme; forcing `tenant: "globex"`
    // writes a Globex row (proving fx.tenant.id + RLS WITH CHECK re-scoped) and,
    // through a distinct principal (no tier-1 cache-dim collision), reads only
    // Globex rows back.
    const carol = await t.auth.loginAs({ id: "carol", tenantId: "acme" });

    const createOverride = await t.api.docs!.create!(
      { title: "Globex Carol" },
      { as: carol, tenant: "globex" },
    );
    expect(createOverride.error).toBeNull();
    expect((createOverride.data as { tenantId: string | null }).tenantId).toBe("globex");

    const listHome = await t.api.docs!.list!(undefined, { as: carol });
    expect(listHome.error).toBeNull();
    expect((listHome.data as { title: string }[]).length).toBe(1);
    expect((listHome.data as { title: string }[])[0]!.title).toBe("Acme Roadmap");

    // Distinct call identity keeps the tier-1 read-cache key apart from the
    // acme-scoped list above (cache dims: flow, input, userId — tenant is a
    // row-level RLS scope, not a cache dimension).
    const dave = await t.auth.loginAs({ id: "dave", tenantId: "acme" });
    const listOverride = await t.api.docs!.list!(undefined, { as: dave, tenant: "globex" });
    expect(listOverride.error).toBeNull();
    // Two Globex rows now: Bob's original + Carol's override write.
    expect((listOverride.data as { title: string }[]).length).toBe(2);
    const overrideTitles = (listOverride.data as { title: string }[])
      .map((r) => r.title)
      .sort();
    expect(overrideTitles).toEqual(["Globex Carol", "Globex Secrets"]);

    await t.close();
  });
});