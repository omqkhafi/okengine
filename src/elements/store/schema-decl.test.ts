/**
 * Abstract store schema — declare → generate → PII.
 */

import { describe, expect, test } from "bun:test";
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
  emitDrizzleSource,
  GENERATED_SCHEMA_HEADER,
  mergeSchemaTables,
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
