/**
 * Widened `field.*` surface — inference, options round-trip, emitter output,
 * and runtime auto-DDL across the full Drizzle Postgres column types.
 */

import { describe, expect, test } from "bun:test";
import type { FieldBuilder } from "./schema-decl.ts";
import { ddlTypeOf, resolveColumns, type ResolvedColumn } from "./table.ts";
import { emitColumnSource, emitDrizzleSource } from "./emit-drizzle.ts";
import { field, id, store } from "../store.ts";

// ---------------------------------------------------------------------------
// Declare-site inference
// ---------------------------------------------------------------------------

describe("field.* — widened inference", () => {
  test("text with enum narrows to literal union", () => {
    const col = field
      .text({ enum: ["todo", "doing", "done"] as const })
      .notNull()
      .finalize("status");
    expect(col.sqlType).toBe("text");
  });

  test("varchar / char carry length + enum options", () => {
    const v = field.varchar({ length: 256 }).finalize("slug");
    expect(v.sqlType).toBe("varchar");
    expect(v.typeOptions?.length).toBe(256);

    const c = field.char({ length: 2 }).finalize("country");
    expect(c.sqlType).toBe("char");
    expect(c.typeOptions?.length).toBe(2);

    const e = field.varchar({ enum: ["a", "b"] as const }).finalize("letter");
    expect(e.sqlType).toBe("varchar");
    expect(e.typeOptions?.enumValues).toEqual(["a", "b"]);
  });

  test("bigint modes round-trip through finalize", () => {
    expect(field.bigint().finalize("a").typeOptions?.mode).toBe("number");
    expect(field.bigint({ mode: "bigint" }).finalize("b").typeOptions?.mode).toBe("bigint");
    expect(field.bigint({ mode: "string" }).finalize("c").typeOptions?.mode).toBe("string");
  });

  test("serial family implies notNull", () => {
    expect(field.serial().finalize("s").notNull).toBe(true);
    expect(field.smallserial().finalize("ss").notNull).toBe(true);
    expect(field.bigserial().finalize("bs").notNull).toBe(true);
    expect(field.bigserial({ mode: "bigint" }).finalize("bs2").typeOptions?.mode).toBe("bigint");
  });

  test("numeric precision/scale/mode round-trip; decimal aliases numeric", () => {
    const n = field.numeric({ precision: 10, scale: 2 }).finalize("amount");
    expect(n.sqlType).toBe("numeric");
    expect(n.typeOptions?.precision).toBe(10);
    expect(n.typeOptions?.scale).toBe(2);

    const m = field.numeric({ mode: "number" }).finalize("amt_num");
    expect(m.typeOptions?.mode).toBe("number");

    const d = field.decimal({ precision: 6, scale: 3 }).finalize("rate");
    expect(d.sqlType).toBe("numeric");
    expect(d.typeOptions).toEqual({ precision: 6, scale: 3 });
  });

  test("temporal defaults are date mode; string opt-in recorded", () => {
    // Default timestamp pins nothing at declare time — OKE's emitter pins mode.
    const ts = field.timestamp().finalize("created");
    expect(ts.sqlType).toBe("timestamp");
    expect(ts.typeOptions?.mode).toBe("date");

    const tsStr = field.timestamp({ mode: "string" }).finalize("wire_at");
    expect(tsStr.typeOptions?.mode).toBe("string");

    const tsTz = field.timestamp({ withTimezone: true, precision: 6 }).finalize("seen_at");
    expect(tsTz.typeOptions?.withTimezone).toBe(true);
    expect(tsTz.typeOptions?.precision).toBe(6);

    const d = field.date().finalize("day");
    expect(d.sqlType).toBe("date");
    expect(d.typeOptions?.mode).toBe("date");

    const dStr = field.date({ mode: "string" }).finalize("wire_day");
    expect(dStr.typeOptions?.mode).toBe("string");
  });

  test("time is string-physics; interval carries fields qualifier", () => {
    const t = field.time({ precision: 3 }).finalize("at");
    expect(t.typeOptions?.precision).toBe(3);

    const i = field.interval({ fields: "year to month", precision: 2 }).finalize("span");
    expect(i.sqlType).toBe("interval");
    expect(i.typeOptions?.fields).toBe("year to month");
    expect(i.typeOptions?.precision).toBe(2);
  });

  test("point / line default to tuple mode", () => {
    const p = field.point().finalize("loc");
    expect(p.typeOptions?.mode).toBe("tuple");
    const xy = field.point({ mode: "xy" }).finalize("loc_xy");
    expect(xy.typeOptions?.mode).toBe("xy");

    const l = field.line().finalize("ln");
    expect(l.typeOptions?.mode).toBe("tuple");
    const abc = field.line({ mode: "abc" }).finalize("ln_abc");
    expect(abc.typeOptions?.mode).toBe("abc");
  });

  test("network + binary + json factories record their sql type", () => {
    expect(field.uuid().finalize("u").sqlType).toBe("uuid");
    expect(field.bytea().finalize("blob_col").sqlType).toBe("bytea");
    expect(field.json().finalize("meta").sqlType).toBe("json");
    expect(field.jsonb().finalize("doc").sqlType).toBe("jsonb");
    expect(field.inet().finalize("ip").sqlType).toBe("inet");
    expect(field.cidr().finalize("net").sqlType).toBe("cidr");
    expect(field.macaddr().finalize("mac").sqlType).toBe("macaddr");
    expect(field.macaddr8().finalize("mac8").sqlType).toBe("macaddr8");
    expect(field.boolean().finalize("active").sqlType).toBe("boolean");
    expect(field.smallint().finalize("small").sqlType).toBe("smallint");
    expect(field.real().finalize("r").sqlType).toBe("real");
    expect(field.doublePrecision().finalize("d").sqlType).toBe("doublePrecision");
  });

  test(".type<T>() override preserves state and nullability", () => {
    const branded = field.uuid().primaryKey().finalize("id") as unknown as ReturnType<
      FieldBuilder<string, true>["type"]
    >;
    void branded;

    const b = field.text();
    const overridden = b.type<{ brand: "x" }>();
    const col = (overridden as FieldBuilder<unknown, false>).notNull().finalize("thing");
    expect(col.sqlType).toBe("text");
    expect(col.notNull).toBe(true);
  });

  test(".okid() is a prepared id default — string columns only", () => {
    const col = field.text().notNull().okid();
    const decl = col.finalize("id");
    expect(decl.defaultFnKind).toBe("id");
    expect(typeof decl.defaultFn).toBe("function");
    expect(String(decl.defaultFn!())).toMatch(/^[A-Za-z0-9-_]{21}$/);

    // Non-string columns reject .okid() at the type level.
    // @ts-expect-error — .okid() requires a string-typed column
    field.integer().okid();
    // @ts-expect-error — shared builder widened to unknown does not permit .okid()
    (field.text() as FieldBuilder<unknown, false>).okid();
  });

  test("field.id() is a prepared default-generation-id text column", () => {
    const col = field.id().primaryKey().finalize("id");
    expect(col.sqlType).toBe("text");
    expect(col.notNull).toBe(true);
    expect(col.primaryKey).toBe(true);
    expect(col.defaultFnKind).toBe("id");
    expect(typeof col.defaultFn).toBe("function");
    expect(String(col.defaultFn!())).toMatch(/^[A-Za-z0-9-_]{21}$/);
    expect(emitColumnSource(col, "postgres")).toContain(".$defaultFn(id)");
  });

  test("field.okid() is an explicit OK-ID text column", () => {
    const col = field.okid().primaryKey().finalize("id");
    expect(col.sqlType).toBe("text");
    expect(col.notNull).toBe(true);
    expect(col.defaultFnKind).toBe("id");
    expect(String(col.defaultFn!())).toMatch(/^[A-Za-z0-9-_]{21}$/);
    expect(emitColumnSource(col, "postgres")).toContain(".$defaultFn(id)");

    // Same emitted Drizzle as field.id() today (same generator).
    const viaId = field.id().primaryKey().finalize("id");
    expect(emitColumnSource(col, "postgres")).toBe(emitColumnSource(viaId, "postgres"));
  });

  test(".now() is a prepared default — resolved to the column's temporal mode", () => {
    // number-shaped column → epoch-ms.
    const col = field.integer().notNull().now();
    const decl = col.finalize("at");
    expect(decl.defaultFnKind).toBe("now");
    expect(typeof decl.defaultFn).toBe("function");
    const v = decl.defaultFn!();
    expect(typeof v).toBe("number");
    expect(v).toBeGreaterThan(0);

    // timestamp (default date mode) → Date object.
    const at = field.timestamp().notNull().now().finalize("seen_at");
    expect(at.defaultFnKind).toBe("nowDate");
    expect(at.defaultFn!() instanceof Date).toBe(true);

    // timestamp ({ mode: "string" }) → ISO-8601 string.
    const born = field.timestamp({ mode: "string" }).notNull().now().finalize("born_at");
    expect(born.defaultFnKind).toBe("nowIso");
    expect(typeof born.defaultFn!()).toBe("string");
  });

  test(".okid()/.now() chain through constraints and emit parity with defaultFn", () => {
    const viaShorthand = field.text().primaryKey().okid().finalize("id");
    const viaDefaultFn = field.text().primaryKey().defaultFn(id).finalize("id");
    expect(viaShorthand.defaultFnKind).toBe(viaDefaultFn.defaultFnKind);
    expect(viaShorthand.defaultFnKind).toBe("id");
    expect(emitColumnSource(viaShorthand, "postgres")).toBe(
      emitColumnSource(viaDefaultFn, "postgres"),
    );

    const atShorthand = field.integer().notNull().now().finalize("created_ms");
    expect(atShorthand.defaultFnKind).toBe("now");
    expect(emitColumnSource(atShorthand, "postgres")).toContain(".$defaultFn(now)");

    const tsShorthand = field.timestamp().notNull().now().finalize("created_at");
    expect(tsShorthand.defaultFnKind).toBe("nowDate");
    expect(emitColumnSource(tsShorthand, "postgres")).toContain(".$defaultFn(nowDate)");

    const dateShorthand = field.timestamp({ mode: "string" }).notNull().now().finalize("born_at");
    expect(dateShorthand.defaultFnKind).toBe("nowIso");
    expect(emitColumnSource(dateShorthand, "postgres")).toContain(".$defaultFn(nowIso)");
  });

  test("options survive schemaTable finalize", () => {
    const events = store.schema.table("events", {
      id: field.uuid().primaryKey().defaultFn(id),
      kind: field.varchar({ length: 64 }).notNull(),
      payload: field.jsonb(),
      at: field.timestamp({ precision: 6, withTimezone: true }).notNull(),
      amount: field.numeric({ precision: 12, scale: 4 }),
    });
    expect(events.columns.kind.typeOptions?.length).toBe(64);
    expect(events.columns.at.typeOptions).toEqual({
      precision: 6,
      withTimezone: true,
      mode: "date",
    });
    expect(events.columns.amount.typeOptions).toEqual({ precision: 12, scale: 4 });
  });
});

// ---------------------------------------------------------------------------
// Drizzle emitter — per-type source
// ---------------------------------------------------------------------------

describe("emitColumnSource — per-type drizzle-exact output", () => {
  function src(col: Parameters<typeof emitColumnSource>[0]): string {
    return emitColumnSource(col);
  }

  test("integer widens to bigint with explicit number mode", () => {
    expect(src(store.schema.table("t", { n: field.integer() }).columns.n!)).toBe(
      'bigint("n", { mode: "number" })',
    );
  });

  test("varchar emits length config", () => {
    expect(src(field.varchar({ length: 256 }).finalize("slug"))).toBe(
      'varchar("slug", { length: 256 })',
    );
  });

  test("text enum emits enum config", () => {
    expect(src(field.text({ enum: ["a", "b"] as const }).finalize("status"))).toBe(
      'text("status", { enum: ["a","b"] })',
    );
  });

  test("timestamp always pins mode explicitly", () => {
    expect(src(field.timestamp().finalize("created"))).toBe(
      'timestamp("created", { mode: "date" })',
    );
    expect(src(field.timestamp({ mode: "string" }).finalize("born"))).toBe(
      'timestamp("born", { mode: "string" })',
    );
    expect(
      src(field.timestamp({ mode: "date", precision: 6, withTimezone: true }).finalize("seen")),
    ).toBe('timestamp("seen", { mode: "date", precision: 6, withTimezone: true })');
  });

  test("date always pins mode explicitly", () => {
    expect(src(field.date().finalize("day"))).toBe('date("day", { mode: "date" })');
    expect(src(field.date({ mode: "string" }).finalize("bd"))).toBe(
      'date("bd", { mode: "string" })',
    );
  });

  test("numeric emits precision/scale/mode via config object", () => {
    expect(src(field.numeric({ precision: 10, scale: 2 }).finalize("amount"))).toBe(
      'numeric("amount", { precision: 10, scale: 2 })',
    );
    expect(src(field.numeric({ mode: "number" }).finalize("m")).trim()).toContain('mode: "number"');
  });

  test("bigserial emits explicit mode; serial stays bare", () => {
    // Serial family is NOT NULL by SQL physics — emitter appends .notNull().
    expect(src(field.bigserial({ mode: "bigint" }).finalize("bs"))).toBe(
      'bigserial("bs", { mode: "bigint" }).notNull()',
    );
    expect(src(field.serial().finalize("s"))).toBe('serial("s").notNull()');
  });

  test("geometric modes emit only when non-default", () => {
    expect(src(field.point({ mode: "xy" }).finalize("p"))).toBe('point("p", { mode: "xy" })');
    expect(src(field.point().finalize("p2"))).toBe('point("p2")');
    expect(src(field.line({ mode: "abc" }).finalize("l"))).toBe('line("l", { mode: "abc" })');
  });

  test("time / interval configs pass through", () => {
    expect(src(field.time({ withTimezone: true, precision: 3 }).finalize("at"))).toBe(
      'time("at", { withTimezone: true, precision: 3 })',
    );
    expect(src(field.interval({ fields: "day to second", precision: 4 }).finalize("span"))).toBe(
      'interval("span", { fields: "day to second", precision: 4 })',
    );
  });

  test("bytea / uuid / network families emit bare calls", () => {
    expect(src(field.bytea().finalize("bin"))).toBe('bytea("bin")');
    expect(src(field.inet().finalize("ip"))).toBe('inet("ip")');
    expect(src(field.macaddr8().finalize("m8"))).toBe('macaddr8("m8")');
    expect(src(field.doublePrecision().finalize("d"))).toBe('doublePrecision("d")');
    expect(src(field.boolean().finalize("b"))).toBe('boolean("b")');
    expect(src(field.jsonb().finalize("j"))).toBe('jsonb("j")');
  });

  test("Date and Buffer defaults serialize as executable literals", () => {
    expect(
      src(
        store.schema.table("t", {
          d: field.date({ mode: "date" }).default(new Date("2025-01-01T00:00:00.000Z")),
        }).columns.d!,
      ),
    ).toBe('date("d", { mode: "date" }).default(new Date("2025-01-01T00:00:00.000Z"))');
    expect(
      src(store.schema.table("t", { b: field.bytea().default(Buffer.from("hi")) }).columns.b!),
    ).toBe(
      `bytea("b").default(Buffer.from(${JSON.stringify(Buffer.from("hi").toString("base64"))}, "base64"))`,
    );
  });

  test("pg-core import list collects used factories dynamically", () => {
    const events = store.schema.table("events", {
      id: field.uuid().primaryKey().defaultFn(id),
      doc: field.jsonb(),
      at: field.timestamp({ mode: "date" }).notNull(),
    });
    const out = emitDrizzleSource([events], "postgres");
    expect(out).toContain('import { pgTable, uuid, jsonb, timestamp } from "drizzle-orm/pg-core"');
    expect(out).not.toContain(" bigint,");
  });

  test("emitted source loads against real drizzle-orm rc.5 factories", async () => {
    const events = store.schema.table("events", {
      id: field.uuid().primaryKey().defaultFn(id),
      status: field.text({ enum: ["new", "archived"] as const }),
      slug: field.varchar({ length: 128 }).notNull().unique(),
      doc: field.jsonb(),
      at: field.timestamp({ mode: "date", withTimezone: true }).notNull(),
      day: field.date(),
      amount: field.numeric({ precision: 12, scale: 2 }),
      ratio: field.numeric({ mode: "number" }),
      span: field.interval({ fields: "day to second" }),
      loc: field.point({ mode: "xy" }),
      ip: field.inet(),
      bin: field.bytea(),
      big: field.bigserial({ mode: "bigint" }),
      small: field.smallint(),
      exact: field.doublePrecision(),
      flag: field.boolean(),
    });
    const out = emitDrizzleSource([events], "postgres");
    // Write under the repo's gitignored .oke/ scratch so `drizzle-orm/pg-core`
    // resolves through workspace node_modules.
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const path = await import("node:path");
    const dir = path.join(".oke", "emit-test", crypto.randomUUID().slice(0, 8));
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "schema.drizzle.ts");
    writeFileSync(file, out);
    try {
      const mod = (await import(path.resolve(file))) as Record<string, unknown>;
      expect(Object.keys(mod)).toContain("events");
      const tableObj = mod.events as Record<string, unknown>;
      expect(Object.keys(tableObj)).toEqual(
        expect.arrayContaining(["id", "status", "slug", "doc", "at", "amount"]),
      );
    } finally {
      rmSync(path.dirname(dir), { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Runtime auto-DDL — shared mapper
// ---------------------------------------------------------------------------

describe("ddlTypeOf — unparameterized PG DDL names", () => {
  test("int family maps per width rules", () => {
    expect(ddlTypeOf("smallint")).toBe("INTEGER");
    expect(ddlTypeOf("smallserial")).toBe("INTEGER");
    expect(ddlTypeOf("integer")).toBe("BIGINT");
    expect(ddlTypeOf("bigint")).toBe("BIGINT");
    expect(ddlTypeOf("serial")).toBe("BIGINT");
    expect(ddlTypeOf("bigserial")).toBe("BIGINT");
  });

  test("float family splits REAL vs DOUBLE PRECISION vs NUMERIC", () => {
    expect(ddlTypeOf("real")).toBe("REAL");
    expect(ddlTypeOf("doublePrecision")).toBe("DOUBLE PRECISION");
    expect(ddlTypeOf("numeric")).toBe("NUMERIC");
  });

  test("json/jsonb collapse to JSONB; bytea/geometric/temporals map", () => {
    expect(ddlTypeOf("json")).toBe("JSONB");
    expect(ddlTypeOf("jsonb")).toBe("JSONB");
    expect(ddlTypeOf("bytea")).toBe("BYTEA");
    expect(ddlTypeOf("point")).toBe("POINT");
    expect(ddlTypeOf("line")).toBe("LINE");
    expect(ddlTypeOf("timestamp")).toBe("TIMESTAMP");
    expect(ddlTypeOf("date")).toBe("DATE");
  });

  test("text-shaped types fall back to TEXT", () => {
    for (const t of [
      "text",
      "varchar",
      "char",
      "uuid",
      "time",
      "interval",
      "inet",
      "cidr",
      "macaddr",
      "macaddr8",
    ]) {
      expect(ddlTypeOf(t)).toBe("TEXT");
    }
    expect(ddlTypeOf("something-new")).toBe("TEXT");
  });

  test("resolveColumns consumes the mapper on TableHandles", () => {
    const handle = {
      name: "mixed",
      columns: {
        id: { name: "id" },
        count: { name: "count", sqlType: "integer" },
        active: { name: "active", sqlType: "boolean" },
        doc: { name: "doc", sqlType: "jsonb" },
        at: { name: "at", sqlType: "timestamp" },
      },
    };
    const cols = resolveColumns(handle) as ResolvedColumn[];
    expect(cols.map((c) => c.sqlName)).toEqual(["id", "count", "active", "doc", "at"]);
    expect(cols.find((c) => c.sqlName === "id")!.sqlType).toBe("TEXT");
    expect(cols.find((c) => c.sqlName === "count")!.sqlType).toBe("BIGINT");
    expect(cols.find((c) => c.sqlName === "active")!.sqlType).toBe("BOOLEAN");
    expect(cols.find((c) => c.sqlName === "doc")!.sqlType).toBe("JSONB");
    expect(cols.find((c) => c.sqlName === "at")!.sqlType).toBe("TIMESTAMP");
  });
});
