/**
 * Abstract store schema — declare → generate → PII.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { plugin } from "../../kernel/plugin.ts";
import { createRecordingApi } from "../../kernel/registry.ts";
import {
  classificationsFromTable,
  createStoreRuntime,
  field,
  id,
  isSchemaTableDecl,
  maskRows,
  now,
  PII_MASK,
  store,
  type SqlStoreHandle,
} from "../store.ts";
import {
  discoverDeclareRel,
  discoverGeneratedRel,
  emitDrizzleSource,
  GENERATED_SCHEMA_HEADER,
  maybeEmitDomainSchema,
  mergeSchemaTables,
  resolveEmitPaths,
  tablesFromPluginContributions,
} from "./emit-drizzle.ts";

describe("store.schema.table + field.*", () => {
  test("builds SchemaTableDecl with snake_case sql names and classifications", () => {
    const notes = store.schema.table("notes", {
      id: field.text().primaryKey().defaultFn(id),
      title: field.text().notNull(),
      body: field.text().notNull().pii(),
      createdAt: field.integer().notNull().defaultFn(now),
    });

    expect(notes.kind).toBe("schema-table");
    expect(notes.name).toBe("notes");
    expect(notes.columns.body.classification?.pii).toBe(true);
    expect(notes.columns.createdAt.sqlName).toBe("created_at");
    expect(notes.columns.createdAt.sqlType).toBe("integer");
    expect(notes.columns.id.defaultFnKind).toBe("id");
    expect(notes.columns.createdAt.defaultFnKind).toBe("now");
    expect(typeof notes.id.getSQL).toBe("function");
    expect(() => notes.id.getSQL()).toThrow(/type bridge/);
  });

  test("PII masks via declaration path without Drizzle metadata", async () => {
    const notes = store.schema.table("notes", {
      id: field.text().primaryKey(),
      email: field.text().notNull().pii(),
    });

    // Direct read — no Drizzle duck-typing.
    const fromTable = classificationsFromTable(notes);
    expect(fromTable.email?.pii).toBe(true);

    const views = store.schema.table("views", {
      id: field.text().primaryKey(),
      ownerEmail: field.text().pii(),
    });
    const fromViews = classificationsFromTable(views);
    expect(fromViews.ownerEmail?.pii).toBe(true);
    expect(fromViews.owner_email?.pii).toBe(true);

    const decl = store.sql("notes", { schema: { notes } });
    const runtime = createStoreRuntime({
      drivers: {},
      sql: { notes: { name: "notes", primary: {} } },
    });
    // Register so classificationsFor merges table columns.
    runtime.register(decl);

    const masked = maskRows([{ id: "1", email: "a@b.c" }], {
      classifications: new Map([["notes.email", { pii: true }]]),
      table: "notes",
    });
    expect(masked[0]!.email).toBe(PII_MASK);

    // Runtime path: open handle and query — ensure classificationsFromTable feeds mask.
    const { memorySqlDriver } = await import("../../drivers/index.ts");
    const rt = createStoreRuntime({
      drivers: { sql: memorySqlDriver },
      sql: { notes: { name: "notes", primary: {} } },
    });
    rt.register(decl);
    const handle = (await rt.open(decl, {
      effects: { writes: ["sql:notes"], reads: ["sql:notes"] },
    })) as SqlStoreHandle;
    await handle.ensureTable(notes);
    await handle.insert(notes).values({ id: "1", email: "secret@example.com" });
    const rows = await handle.select().from(notes);
    expect(rows[0]!.email).toBe(PII_MASK);
  });

  test("a `name` column does not break insert / select / emit", async () => {
    const teams = store.schema.table("teams", {
      id: field.text().primaryKey(),
      key: field.text().notNull(),
      name: field.text().notNull(),
    });

    expect(teams.kind).toBe("schema-table");
    expect(teams.tableName).toBe("teams");
    expect(typeof teams.name).toBe("object");
    expect(teams.columns.name.sqlName).toBe("name");

    const src = emitDrizzleSource([teams], "postgres");
    expect(src).toContain('export const teams = pgTable("teams"');

    const { memorySqlDriver } = await import("../../drivers/index.ts");
    const decl = store.sql("app", { schema: { teams } });
    const rt = createStoreRuntime({
      drivers: { sql: memorySqlDriver },
      sql: { app: { name: "app", primary: {} } },
    });
    rt.register(decl);
    const handle = (await rt.open(decl, {
      effects: { writes: ["sql:app"], reads: ["sql:app"] },
    })) as SqlStoreHandle;
    await handle.insert(teams).values({ id: "team_eng", key: "ENG", name: "Engineering" });
    const rows = await handle.select().from(teams);
    expect(rows).toEqual([{ id: "team_eng", key: "ENG", name: "Engineering" }]);
  });

  test("a `kind` column does not hide the table discriminant", () => {
    const tasks = store.schema.table("tasks", {
      id: field.text().primaryKey(),
      kind: field.text().notNull(),
    });
    expect(isSchemaTableDecl(tasks)).toBe(true);
    expect(tasks.kind).toBe("schema-table");
    expect(tasks.columns.kind.sqlName).toBe("kind");
  });
});

describe("emitDrizzleSource — postgres pgTable from one declaration", () => {
  const notes = store.schema.table("notes", {
    id: field.text().primaryKey().defaultFn(id),
    title: field.text().notNull(),
    body: field.text().notNull().pii(),
    createdAt: field.integer().notNull().defaultFn(now),
  });

  test("postgres emits pgTable", () => {
    const src = emitDrizzleSource([notes], "postgres");
    expect(src.startsWith(GENERATED_SCHEMA_HEADER)).toBe(true);
    expect(src).toContain('from "drizzle-orm/pg-core"');
    expect(src).toContain("pgTable");
    expect(src).not.toContain("sqliteTable");
    expect(src).not.toContain("drizzle-orm/sqlite-core");
    expect(src).toContain('text("id").primaryKey().$defaultFn(id)');
    // Postgres INTEGER is 32-bit — abstract integer maps to bigint for ms clocks.
    expect(src).toContain('bigint("created_at", { mode: "number" }).notNull().$defaultFn(now)');
    expect(src).toContain('text("body").notNull()');
  });
});

describe("plugin table columns in generated schema", () => {
  test("plugin field.* columns merge alongside app tables", () => {
    const notes = store.schema.table("notes", {
      id: field.text().primaryKey().defaultFn(id),
      title: field.text().notNull(),
    });

    const audit = plugin("audit", { version: "1.0.0" }).table(
      "audit_events",
      {
        id: field.text().primaryKey().defaultFn(id),
        actorId: field.text().notNull().pii(),
      },
      { plane: "shared" },
    );

    const { api, snapshot } = createRecordingApi({
      name: "audit",
      version: "1.0.0",
    });
    audit.register(api);
    const contributions = snapshot().tables;

    const pluginTables = tablesFromPluginContributions(contributions);
    expect(pluginTables).toHaveLength(1);
    expect(pluginTables[0]!.name).toBe("audit_events");
    expect(pluginTables[0]!.columns.actorId!.classification?.pii).toBe(true);

    const merged = mergeSchemaTables([notes], pluginTables);
    const src = emitDrizzleSource(merged, "postgres");
    expect(src).toContain('pgTable("notes"');
    expect(src).toContain('pgTable("audit_events"');
    expect(src).toContain('text("actor_id").notNull()');
  });

  test("duplicate table names fail merge (no column injection)", () => {
    const app = store.schema.table("users", {
      id: field.text().primaryKey(),
    });
    const pluginUsers = store.schema.table("users", {
      totp: field.text().notNull(),
    });
    expect(() => mergeSchemaTables([app], [pluginUsers])).toThrow(/duplicate table/);
  });
});

describe("emitDrizzleSource — references + relations (Linkly-shaped)", () => {
  const links = store.schema.table("links", {
    id: field.text().primaryKey(),
    code: field.text().notNull().unique(),
    url: field.text().notNull(),
    userId: field.text().notNull(),
    clicks: field.integer().notNull().default(0),
    createdAt: field.integer().notNull(),
  });

  const daily = store.schema.table("daily", {
    id: field.text().primaryKey(),
    code: field
      .text()
      .notNull()
      .references(() => links.code),
    day: field.text().notNull(),
    clicks: field.integer().notNull().default(0),
  });

  const relations = store.schema.relations({ links, daily }, (r) => ({
    links: {
      daily: r.many.daily({
        from: r.links.code,
        to: r.daily.code,
      }),
    },
    daily: {
      link: r.one.links({
        from: r.daily.code,
        to: r.links.code,
        optional: false,
      }),
    },
  }));

  test("postgres emit includes FK + defineRelations", () => {
    const src = emitDrizzleSource([links, daily], "postgres", { relations: [relations] });
    expect(src).toContain("pgTable");
    expect(src).not.toContain("sqliteTable");
    expect(src).toContain(".references(() => links.code)");
    expect(src).toContain('import { defineRelations } from "drizzle-orm"');
    expect(src).toContain("defineRelations({ links, daily }");
    expect(src).toContain("r.many.daily({ from: r.links.code, to: r.daily.code })");
    expect(src).toContain("r.one.links({ from: r.daily.code, to: r.links.code, optional: false })");
  });

  test("column own-property ergonomics for references", () => {
    expect(daily.columns.code.references).toBeDefined();
    expect(daily.columns.code.references!.ref().key).toBe("code");
    expect(daily.columns.code.references!.ref().tableName).toBe("links");
    expect(links.code.sqlName).toBe("code");
  });

  test("relation targets stay declare metadata — not consulted by effect inference", () => {
    expect(relations.config.links?.daily?.target).toBe("daily");
    expect(relations.config.daily?.link?.target).toBe("links");
  });
});

describe("store.schema RLS extras", () => {
  test("helpers stamp rls + named policies", () => {
    const bookings = store.schema.table(
      "bookings",
      {
        id: field.text().primaryKey(),
        owner: field.text().notNull(),
      },
      [
        store.schema.policy.gate("member", { for: "select" }),
        store.schema.policy.owner("owner", { for: "all" }),
        store.schema.policy.scope("booking:create", { for: "insert" }),
      ],
    );
    expect(bookings.rls).toBe(true);
    expect(bookings.policies?.map((p) => p.name)).toEqual([
      "gate_member_select",
      "owner_owner_all",
      "scope_booking_create_insert",
    ]);
    const src = emitDrizzleSource([bookings], "postgres");
    expect(src).toContain("pgPolicy");
    expect(src).toContain("oke.gate() = ");
    expect(src).toContain("oke.user()");
    expect(src).toContain("oke.has_scope(");
  });

  test("rls() without policies emits pgTable.withRLS", () => {
    const notes = store.schema.table("notes", { id: field.text().primaryKey() }, [
      store.schema.rls(),
    ]);
    expect(notes.rls).toBe(true);
    expect(notes.policies).toBeUndefined();
    expect(emitDrizzleSource([notes], "postgres")).toContain("pgTable.withRLS");
  });
});

describe("declare path discovery", () => {
  test("schema.ts wins over schema/index.ts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-decl-priority-"));
    await mkdir(join(dir, "src", "db", "schema"), { recursive: true });
    await writeFile(join(dir, "src", "db", "schema.ts"), "export {}\n");
    await writeFile(join(dir, "src", "db", "schema", "index.ts"), "export {}\n");
    expect(discoverDeclareRel(dir)).toBe("src/db/schema.ts");
    expect(resolveEmitPaths(dir).declarePath).toBe(join(dir, "src/db/schema.ts"));
    await rm(dir, { recursive: true, force: true });
  });

  test("schema.decl.ts when schema.ts is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-decl-prev-"));
    await mkdir(join(dir, "src", "db", "schema"), { recursive: true });
    await writeFile(join(dir, "src", "db", "schema.decl.ts"), "export {}\n");
    await writeFile(join(dir, "src", "db", "schema", "index.ts"), "export {}\n");
    expect(discoverDeclareRel(dir)).toBe("src/db/schema.decl.ts");
    await rm(dir, { recursive: true, force: true });
  });

  test("schema/index.ts when single-file declare is absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-decl-folder-"));
    await mkdir(join(dir, "src", "db", "schema"), { recursive: true });
    await writeFile(join(dir, "src", "db", "schema", "index.ts"), "export {}\n");
    expect(discoverDeclareRel(dir)).toBe("src/db/schema/index.ts");
    await rm(dir, { recursive: true, force: true });
  });

  test("db.declare overrides discovery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-decl-override-"));
    await mkdir(join(dir, "src", "db", "schema"), { recursive: true });
    await writeFile(join(dir, "src", "db", "schema.ts"), "export {}\n");
    const resolved = resolveEmitPaths(dir, { declare: "src/db/schema/index.ts" });
    expect(resolved.declarePath).toBe(join(dir, "src/db/schema/index.ts"));
    await rm(dir, { recursive: true, force: true });
  });

  test("drizzle/index.ts wins over drizzle.ts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-gen-folder-"));
    await mkdir(join(dir, "src", "db", "drizzle"), { recursive: true });
    await writeFile(join(dir, "src", "db", "drizzle", "index.ts"), "export {}\n");
    await writeFile(join(dir, "src", "db", "drizzle.ts"), "export {}\n");
    expect(discoverGeneratedRel(dir, "src/db/schema.ts")).toBe("src/db/drizzle/index.ts");
    await rm(dir, { recursive: true, force: true });
  });

  test("omitted generated is drizzle/index.ts even if older files exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-gen-default-"));
    await mkdir(join(dir, "src", "db"), { recursive: true });
    await writeFile(join(dir, "src", "db", "drizzle.ts"), "export {}\n");
    await writeFile(join(dir, "src", "db", "schema.drizzle.ts"), "export {}\n");
    expect(discoverGeneratedRel(dir, "src/db/schema.ts")).toBe("src/db/drizzle/index.ts");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("maybeEmitDomainSchema — barrel declare", () => {
  test("emits from schema/index.ts without schema.ts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-schema-folder-"));
    const schemaDir = join(dir, "src", "db", "schema");
    await mkdir(schemaDir, { recursive: true });
    const oke = resolve(import.meta.dir, "../../index.ts");
    await writeFile(
      join(schemaDir, "posts.ts"),
      `import { store, field } from ${JSON.stringify(oke)};
export const posts = store.schema.table("posts", {
  id: field.id().primaryKey(),
  title: field.text().notNull(),
});
`,
    );
    await writeFile(join(schemaDir, "index.ts"), `export * from "./posts.ts";\n`);
    const result = await maybeEmitDomainSchema({
      cwd: dir,
      dialect: "postgres",
    });
    expect(result.emitted).toBe(true);
    expect(result.tableCount).toBe(1);
    const generated = await readFile(join(dir, "src", "db", "drizzle", "posts.ts"), "utf8");
    expect(generated).toContain('pgTable("posts"');
    const barrel = await readFile(join(dir, "src", "db", "drizzle", "index.ts"), "utf8");
    expect(barrel).toContain('export * from "./posts.ts"');
    await rm(dir, { recursive: true, force: true });
  });

  test("writes one file per table with FK import + relations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-drizzle-split-"));
    const schemaDir = join(dir, "src", "db", "schema");
    await mkdir(schemaDir, { recursive: true });
    const oke = resolve(import.meta.dir, "../../index.ts");
    await writeFile(
      join(schemaDir, "links.ts"),
      `import { store, field } from ${JSON.stringify(oke)};
export const links = store.schema.table("links", {
  id: field.id().primaryKey(),
  code: field.text().notNull().unique(),
});
`,
    );
    await writeFile(
      join(schemaDir, "daily.ts"),
      `import { store, field } from ${JSON.stringify(oke)};
import { links } from "./links.ts";
export const daily = store.schema.table("daily", {
  id: field.id().primaryKey(),
  code: field.text().notNull().references(() => links.code, { onDelete: "cascade" }),
});
`,
    );
    await writeFile(
      join(schemaDir, "relations.ts"),
      `import { store } from ${JSON.stringify(oke)};
import { daily } from "./daily.ts";
import { links } from "./links.ts";
export const relations = store.schema.relations({ links, daily }, (r) => ({
  links: { daily: r.many.daily({ from: r.links.code, to: r.daily.code }) },
  daily: { link: r.one.links({ from: r.daily.code, to: r.links.code, optional: false }) },
}));
`,
    );
    await writeFile(
      join(schemaDir, "index.ts"),
      `export * from "./links.ts";
export * from "./daily.ts";
export * from "./relations.ts";
`,
    );
    const result = await maybeEmitDomainSchema({ cwd: dir, dialect: "postgres" });
    expect(result.emitted).toBe(true);
    expect(result.tableCount).toBe(2);
    const daily = await readFile(join(dir, "src", "db", "drizzle", "daily.ts"), "utf8");
    expect(daily).toContain('import { links } from "./links.ts"');
    expect(daily).toContain(".references(() => links.code");
    const rel = await readFile(join(dir, "src", "db", "drizzle", "relations.ts"), "utf8");
    expect(rel).toContain("defineRelations({ links, daily }");
    const barrel = await readFile(join(dir, "src", "db", "drizzle", "index.ts"), "utf8");
    expect(barrel).toContain('export * from "./relations.ts"');
    await rm(dir, { recursive: true, force: true });
  });

  test("prunes stale generated files and drops sibling drizzle.ts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-drizzle-prune-"));
    const schemaDir = join(dir, "src", "db", "schema");
    await mkdir(schemaDir, { recursive: true });
    await mkdir(join(dir, "src", "db", "drizzle"), { recursive: true });
    const oke = resolve(import.meta.dir, "../../index.ts");
    await writeFile(
      join(schemaDir, "posts.ts"),
      `import { store, field } from ${JSON.stringify(oke)};
export const posts = store.schema.table("posts", {
  id: field.id().primaryKey(),
});
`,
    );
    await writeFile(join(schemaDir, "index.ts"), `export * from "./posts.ts";\n`);
    await writeFile(
      join(dir, "src", "db", "drizzle.ts"),
      `// generated by oke — do not edit\nexport const stale = true;\n`,
    );
    await writeFile(
      join(dir, "src", "db", "drizzle", "gone.ts"),
      `// generated by oke — do not edit\nexport const gone = true;\n`,
    );
    await maybeEmitDomainSchema({ cwd: dir, dialect: "postgres" });
    expect(await Bun.file(join(dir, "src", "db", "drizzle.ts")).exists()).toBe(false);
    expect(await Bun.file(join(dir, "src", "db", "drizzle", "gone.ts")).exists()).toBe(false);
    expect(await Bun.file(join(dir, "src", "db", "drizzle", "posts.ts")).exists()).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
