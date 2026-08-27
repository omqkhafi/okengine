/**
 * Abstract store schema — ORM-agnostic declare site (`field.*` + `store.schema.table`).
 *
 * Survey-backed v1 primitives: `text` · `integer` + modifiers + PII tags + FKs.
 * Dialect-specific Drizzle is emitted separately ({@link emitDrizzleSource}).
 */

import type { ColumnClassification } from "../../manifest/types.ts";
import { lazyRequire } from "../../kernel/lazy-require.ts";
import type { PolicyGateDecl } from "../gate/declare.ts";
import type { ColumnDef, TableHandle } from "./table.ts";
import {
  id as idHelper,
  now as nowHelper,
  nowIso as nowIsoHelper,
  nowDate as nowDateHelper,
} from "./table.ts";

/**
 * SQL type primitives — the full Drizzle Postgres column-type surface.
 * Factory names mirror `drizzle-orm/pg-core` exactly.
 */
export type FieldSqlType =
  | "text"
  | "varchar"
  | "char"
  | "boolean"
  | "smallint"
  | "integer"
  | "bigint"
  | "serial"
  | "smallserial"
  | "bigserial"
  | "numeric"
  | "real"
  | "doublePrecision"
  | "json"
  | "jsonb"
  | "uuid"
  | "time"
  | "timestamp"
  | "date"
  | "interval"
  | "point"
  | "line"
  | "bytea"
  | "inet"
  | "cidr"
  | "macaddr"
  | "macaddr8";

/** Timestamp / time precision — mirrors drizzle-orm rc.5 `Precision` union. */
export type FieldPrecision = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** JS mapping for temporal (`timestamp` / `date`) columns. */
export type TemporalMode = "date" | "string";

/** JS mapping for `bigint` columns. */
export type BigIntMode = "number" | "bigint" | "string";

/** JS mapping for `numeric` columns. */
export type NumericMode = "string" | "number" | "bigint";

/** Tuple vs object mapping for geometric `point` columns. */
export type PointMode = "tuple" | "xy";

/** Tuple vs equation-object mapping for geometric `line` columns. */
export type LineMode = "tuple" | "abc";

/** Postgres `interval` field subset — mirrors drizzle-orm rc.5 `IntervalConfig["fields"]`. */
export type IntervalField =
  | "year"
  | "month"
  | "day"
  | "hour"
  | "minute"
  | "second"
  | "year to month"
  | "day to hour"
  | "day to minute"
  | "day to second"
  | "hour to minute"
  | "hour to second"
  | "minute to second";

/**
 * Per-type options recorded on a column (`length`, `precision`, `scale`,
 * `withTimezone`, `mode`, `fields`, `enumValues`). Only the keys relevant to
 * {@link SchemaColumnDecl.sqlType} are populated.
 */
export interface FieldTypeOptions {
  /** `varchar` / `char` max length. */
  readonly length?: number;
  /** `time` / `timestamp` fractional-second digits (0–6). */
  readonly precision?: number;
  /** `numeric(p, s)` scale digits. */
  readonly scale?: number;
  /** `time` / `timestamp` timezone flavor. */
  readonly withTimezone?: boolean;
  /** JS mapping selector (`TemporalMode` / `BigIntMode` / `NumericMode` / `PointMode` / `LineMode`). */
  readonly mode?: string;
  /** `interval` field qualifier. */
  readonly fields?: IntervalField;
  /** Allowed string values (`text` / `varchar` / `char` enum). */
  readonly enumValues?: readonly string[];
}

/** Known `$defaultFn` helpers recognized by the Drizzle emitter. */
export type DefaultFnKind = "id" | "now" | "nowIso" | "nowDate" | "custom";

/** FK action — mirrors Drizzle `UpdateDeleteAction`. */
export type ReferenceAction = "cascade" | "restrict" | "no action" | "set null" | "set default";

/** Optional ON DELETE / ON UPDATE for {@link FieldBuilder.references}. */
export interface ReferenceActions {
  readonly onDelete?: ReferenceAction;
  readonly onUpdate?: ReferenceAction;
}

/** Resolved foreign-key target (lazy ref evaluated at finalize/emit). */
export interface ColumnReference {
  /** Lazy target column (evaluated when emitting / finalizing). */
  readonly ref: () => SchemaColumnDecl;
  readonly actions?: ReferenceActions;
}

/**
 * Finalized column declaration — also satisfies {@link ColumnDef} so
 * {@link classificationsFromTable} / runtime masking work without Drizzle.
 *
 * `getSQL` is a structural bridge so drizzle-orm operators (`eq`, `isNull`, …)
 * accept abstract columns in TypeScript. OKE’s SQL compiler never calls it —
 * it reads {@link SchemaColumnDecl.sqlName} / metadata directly.
 *
 * `TData` / `TNotNull` are type-level only (`$infer` is a phantom). They let
 * {@link InferColumnJs} / table `$inferSelect` resolve real row shapes.
 */
export interface SchemaColumnDecl<
  TData = unknown,
  TNotNull extends boolean = boolean,
> extends ColumnDef {
  /** JS object key (e.g. `createdAt`). */
  readonly key: string;
  /** Database column name (e.g. `created_at`). */
  readonly sqlName: string;
  /** Declared SQL type. */
  readonly sqlType: FieldSqlType;
  readonly primaryKey: boolean;
  readonly notNull: TNotNull;
  /**
   * Phantom JS value type — not present at runtime. Distinguishes `string`
   * vs `number` so structural typing does not collapse column data types.
   */
  readonly $infer?: TData;
  readonly unique: boolean;
  /** Literal `.default(v)` when set. */
  readonly defaultValue?: string | number | boolean | Date | Buffer | null;
  /** Runtime default applied on insert when the key is missing. */
  readonly defaultFn?: () => unknown;
  /** Emitter hint for `$defaultFn(id|now)`. */
  readonly defaultFnKind?: DefaultFnKind;
  /** Owning table SQL name (stamped by {@link schemaTable}). */
  readonly tableName?: string;
  /** Foreign key when `.references()` was used. */
  readonly references?: ColumnReference;
  /** Per-type options (`length`, `precision`, `mode`, `enumValues`, …). */
  readonly typeOptions?: FieldTypeOptions;
  /** Optional human description for Console / docs (falls back to the JS key). */
  readonly description?: string;
  /**
   * Drizzle `SQLWrapper` structural match — never invoked at runtime.
   *
   * @returns never (throws if called)
   */
  getSQL(): never;
}

/** Policy command on a {@link SchemaPolicyDecl}. */
export type SchemaPolicyFor = "all" | "select" | "insert" | "update" | "delete";

/** Policy behavior on a {@link SchemaPolicyDecl}. */
export type SchemaPolicyAs = "permissive" | "restrictive";

/**
 * Drizzle-shaped policy extra (`pgPolicy` emit).
 */
export interface SchemaPolicyDecl {
  readonly kind: "schema-policy";
  readonly name: string;
  readonly as?: SchemaPolicyAs;
  readonly to?: string | readonly string[];
  readonly for?: SchemaPolicyFor;
  readonly using?: string;
  readonly withCheck?: string;
}

/** Enable RLS with no policies (`pgTable.withRLS`). */
export interface SchemaRlsEnableDecl {
  readonly kind: "schema-rls";
}

/** Opt out of tenant isolation for a schema table when tenancy is on. */
export interface SchemaTenantScopedDecl {
  readonly kind: "schema-tenant-scoped";
  readonly tenantScoped: false;
}

/** Third-arg extra for {@link schemaTable}. */
export type SchemaTableExtra = SchemaPolicyDecl | SchemaRlsEnableDecl | SchemaTenantScopedDecl;

/** Options for {@link schemaPolicy} / Gate helpers. */
export interface SchemaPolicyOptions {
  readonly as?: SchemaPolicyAs;
  readonly to?: string | readonly string[];
  readonly for?: SchemaPolicyFor;
  readonly using?: string;
  readonly withCheck?: string;
}

/** Table from {@link store.schema.table} — extends {@link TableHandle}. */
export interface SchemaTableDecl extends TableHandle {
  readonly kind: "schema-table";
  readonly columns: Readonly<Record<string, SchemaColumnDecl>>;
  /**
   * SQL table name. Non-enumerable when a column is also named `name`
   * (spreading columns would otherwise shadow {@link TableHandle.name}).
   */
  readonly tableName?: string;
  /** `true` when {@link schemaRls} was declared or any policy is present. */
  readonly rls?: boolean;
  /** Declared policies (emit + Manifest). */
  readonly policies?: readonly SchemaPolicyDecl[];
  /** When `false`, skip fail-loud tenant-policy requirement. */
  readonly tenantScoped?: boolean;
}

/**
 * Fluent field builder before key finalization.
 *
 * `TData` is the JS value type (`string` / `number`). `TNotNull` is `true`
 * after `.notNull()` or `.primaryKey()` — matching runtime finalize.
 */
export interface FieldBuilder<TData = unknown, TNotNull extends boolean = false> {
  primaryKey(): FieldBuilder<TData, true>;
  notNull(): FieldBuilder<TData, true>;
  unique(): FieldBuilder<TData, TNotNull>;
  default(value: TData | null): FieldBuilder<TData, TNotNull>;
  defaultFn(fn: () => TData): FieldBuilder<TData, TNotNull>;
  /**
   * Prepared default — a fresh OKID string on every insert. Sugar for
   * `defaultFn(okid)`; the emitter compiles it to Drizzle `$defaultFn(id)`.
   *
   * Only string-typed columns expose it (a non-string builder types the
   * member as `undefined`, so misuse fails TypeScript with a "possibly
   * undefined" error).
   *
   * ```ts
   * id: field.text().primaryKey().okid(),
   * ```
   */
  okid: TData extends string ? () => FieldBuilder<TData, TNotNull> : undefined;
  /**
   * Prepared default — the current instant, shaped to this column.
   *
   * Sugar for `defaultFn(now | nowIso | nowDate)`; the emitter compiles it to
   * Drizzle `$defaultFn(...)`. The resolved helper follows the column's SQL
   * type and temporal mode:
   *
   * - number columns → epoch-ms (`now`)
   * - `timestamp` / `date` (default `{ mode: "date" }`) → `Date` (`nowDate`)
   * - `timestamp` / `date` with `{ mode: "string" }` → ISO-8601 string
   *   (`nowIso`)
   *
   * Non-temporal string columns also resolve to an ISO string.
   *
   * ```ts
   * createdAt: field.integer().notNull().now(),          // epoch-ms number
   * bornAt:   field.timestamp().notNull().now(),          // Date object
   * seenAt:   field.timestamp({ mode: "string" }).now(),  // ISO string
   * ```
   */
  now: TData extends number | Date | string ? () => FieldBuilder<TData, TNotNull> : undefined;
  pii(): FieldBuilder<TData, TNotNull>;
  sensitive(): FieldBuilder<TData, TNotNull>;
  retain(duration: string): FieldBuilder<TData, TNotNull>;
  /** Override snake_case SQL name. */
  as(sqlName: string): FieldBuilder<TData, TNotNull>;
  /** Optional human description for Console / docs (falls back to the JS key). */
  describe(description: string): FieldBuilder<TData, TNotNull>;
  /**
   * Override the inferred JS value type (mirrors Drizzle `$type<T>()`).
   *
   * ```ts
   * field.uuid().type<UserId & { __brand: "user_id" }>()
   * ```
   */
  type<T>(): FieldBuilder<T, TNotNull>;
  /**
   * Declare a foreign key to another column (dialect-agnostic).
   *
   * @param ref - Lazy target column (`() => links.code`)
   * @param actions - Optional ON DELETE / ON UPDATE
   */
  references(
    ref: () => SchemaColumnDecl,
    actions?: ReferenceActions,
  ): FieldBuilder<TData, TNotNull>;
  /**
   * Bind the JS key and produce a {@link SchemaColumnDecl}.
   *
   * @param key - Object key in the table column map
   */
  finalize(key: string): SchemaColumnDecl<TData, TNotNull>;
}

interface FieldState {
  readonly sqlType: FieldSqlType;
  readonly primaryKey: boolean;
  readonly notNull: boolean;
  readonly unique: boolean;
  readonly defaultValue?: string | number | boolean | Date | Buffer | null;
  readonly defaultFn?: () => unknown;
  readonly defaultFnKind?: DefaultFnKind;
  readonly classification?: ColumnClassification;
  readonly sqlName?: string;
  readonly description?: string;
  readonly references?: ColumnReference;
  readonly typeOptions?: FieldTypeOptions;
}

function camelToSnake(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function defaultFnKindOf(fn: () => unknown): DefaultFnKind {
  if (fn === idHelper) return "id";
  if (fn === nowHelper) return "now";
  if (fn === nowIsoHelper) return "nowIso";
  if (fn === nowDateHelper) return "nowDate";
  const name = typeof fn.name === "string" ? fn.name : "";
  if (name === "id") return "id";
  if (name === "okid") return "id";
  if (name === "now") return "now";
  if (name === "nowIso") return "nowIso";
  if (name === "nowDate") return "nowDate";
  return "custom";
}

function mergeClassification(
  current: ColumnClassification | undefined,
  patch: ColumnClassification,
): ColumnClassification {
  return { ...(current ?? {}), ...patch };
}

function createBuilder<TData, TNotNull extends boolean>(
  state: FieldState,
): FieldBuilder<TData, TNotNull> {
  const next = <N extends boolean>(patch: Partial<FieldState>): FieldBuilder<TData, N> =>
    createBuilder<TData, N>({ ...state, ...patch });

  return {
    primaryKey: () => next<true>({ primaryKey: true, notNull: true }),
    notNull: () => next<true>({ notNull: true }),
    unique: () => next<TNotNull>({ unique: true }),
    default: (value) => next<TNotNull>({ defaultValue: value as FieldState["defaultValue"] }),
    defaultFn: (fn) =>
      next<TNotNull>({
        defaultFn: fn as () => unknown,
        defaultFnKind: defaultFnKindOf(fn as () => unknown),
      }),
    okid: (() =>
      next<TNotNull>({
        defaultFn: idHelper,
        defaultFnKind: "id",
      })) as FieldBuilder<TData, TNotNull>["okid"],
    now: (() => {
      const sqlType = state.sqlType;
      const mode = state.typeOptions?.mode;
      // Number-typed columns — epoch-ms default.
      const numericTypes = new Set<FieldSqlType>([
        "smallint",
        "integer",
        "bigint",
        "serial",
        "smallserial",
        "bigserial",
        "numeric",
        "real",
        "doublePrecision",
      ]);
      if (numericTypes.has(sqlType)) {
        return next<TNotNull>({ defaultFn: nowHelper, defaultFnKind: "now" });
      }
      // Date-object temporal columns `{ mode: "date" }`.
      if (mode === "date" && (sqlType === "timestamp" || sqlType === "date")) {
        return next<TNotNull>({ defaultFn: nowDateHelper, defaultFnKind: "nowDate" });
      }
      // Everything else — ISO-8601 string default.
      return next<TNotNull>({ defaultFn: nowIsoHelper, defaultFnKind: "nowIso" });
    }) as FieldBuilder<TData, TNotNull>["now"],
    pii: () =>
      next<TNotNull>({ classification: mergeClassification(state.classification, { pii: true }) }),
    sensitive: () =>
      next<TNotNull>({
        classification: mergeClassification(state.classification, { sensitive: true }),
      }),
    retain: (duration) =>
      next<TNotNull>({
        classification: mergeClassification(state.classification, { retain: duration }),
      }),
    as: (sqlName) => next<TNotNull>({ sqlName }),
    describe: (description) => next<TNotNull>({ description }),
    type: () => createBuilder<unknown, TNotNull>(state) as FieldBuilder<never, TNotNull> as never,
    references: (ref, actions) =>
      next<TNotNull>({
        references: actions ? { ref, actions } : { ref },
      }),
    finalize(key: string): SchemaColumnDecl<TData, TNotNull> {
      const sqlName = state.sqlName ?? camelToSnake(key);
      return {
        key,
        name: sqlName,
        sqlName,
        sqlType: state.sqlType,
        primaryKey: state.primaryKey,
        notNull: (state.notNull || state.primaryKey) as TNotNull,
        unique: state.unique,
        ...(state.defaultValue !== undefined ? { defaultValue: state.defaultValue } : {}),
        ...(state.defaultFn ? { defaultFn: state.defaultFn } : {}),
        ...(state.defaultFnKind ? { defaultFnKind: state.defaultFnKind } : {}),
        ...(state.classification ? { classification: state.classification } : {}),
        ...(state.description !== undefined ? { description: state.description } : {}),
        ...(state.references ? { references: state.references } : {}),
        ...(state.typeOptions !== undefined && Object.keys(state.typeOptions).length > 0
          ? { typeOptions: state.typeOptions }
          : {}),
        getSQL(): never {
          throw new Error(
            `SchemaColumnDecl.getSQL("${sqlName}") is a type bridge — OKE compiles columns directly`,
          );
        },
      };
    },
  };
}

/**
 * Field builders — the full Drizzle Postgres column-type surface.
 *
 * Factory names mirror `drizzle-orm/pg-core` exactly (`field.text()` ·
 * `field.timestamp()` · …). Options bags carry the per-type knobs (`length`,
 * `precision`, `mode`, …) and JS inference follows Drizzle's mapping rules —
 * with OKE defaults: temporals infer `Date` unless `{ mode: "string" }`,
 * and the serial family is NOT NULL by SQL physics.
 */
export const field = {
  /**
   * Text id column with the default generation id pre-applied.
   *
   * The "default generation id" currently resolves to OKID, so
   * `field.id()` ≡ `field.text().okid()` — it infers `string` and emits a
   * `$defaultFn(id)` to be minted on insert.
   *
   * ```ts
   * id: field.id().primaryKey(),
   * ```
   */
  id: (() => fieldOf("text", { defaultFn: idHelper, defaultFnKind: "id" })) as FieldApi["id"],

  /**
   * Text id column explicitly generated with OK ID.
   *
   * Unlike {@link field.id} (which follows whatever the default generation id
   * becomes), this pins OK ID. Today that is the same generator.
   *
   * ```ts
   * id: field.okid().primaryKey(),
   * ```
   */
  okid: (() => fieldOf("text", { defaultFn: idHelper, defaultFnKind: "id" })) as FieldApi["okid"],

  /** Variable-length string; `{ enum: [...] }` narrows to a literal union. */
  text: ((options?: { readonly enum?: readonly string[] }) =>
    fieldOf("text", mergeOptions({ enumValues: options?.enum }))) as FieldApi["text"],

  /** Bounded string; `{ length }` emits `varchar(n)`, `{ enum }` narrows literals. */
  varchar: ((options?: { readonly length?: number; readonly enum?: readonly string[] }) =>
    fieldOf(
      "varchar",
      mergeOptions({ length: options?.length }, { enumValues: options?.enum }),
    )) as FieldApi["varchar"],

  /** Fixed-length blank-padded string; same knobs as {@link field.varchar}. */
  char: ((options?: { readonly length?: number; readonly enum?: readonly string[] }) =>
    fieldOf(
      "char",
      mergeOptions({ length: options?.length }, { enumValues: options?.enum }),
    )) as FieldApi["char"],

  boolean: (() => fieldOf("boolean")) as FieldApi["boolean"],
  smallint: (() => fieldOf("smallint")) as FieldApi["smallint"],
  integer: (() => fieldOf("integer")) as FieldApi["integer"],

  /** `bigint` — defaults to JS `number`; rc.5 requires an explicit mode upstream, ours absorbs it. */
  bigint: ((options?: { readonly mode?: "number" | "bigint" | "string" }) =>
    fieldOf("bigint", mergeOptions({ mode: options?.mode ?? "number" }))) as FieldApi["bigint"],

  /** Auto-incrementing int4 — NOT NULL by SQL physics. */
  serial: (() => notNullFieldOf("serial")) as FieldApi["serial"],
  /** Auto-incrementing int2 — NOT NULL by SQL physics. */
  smallserial: (() => notNullFieldOf("smallserial")) as FieldApi["smallserial"],

  /** Auto-incrementing int8 — NOT NULL; defaults to JS `number`. */
  bigserial: ((options?: { readonly mode?: "number" | "bigint" }) =>
    notNullFieldOf(
      "bigserial",
      mergeOptions({ mode: options?.mode ?? "number" }),
    )) as FieldApi["bigserial"],

  /**
   * Exact-decimal `numeric(p, s)` — infers `string` by default (Drizzle
   * physics: avoids float error); opt into `number` / `bigint` via `mode`.
   */
  numeric: ((options?: {
    readonly precision?: number;
    readonly scale?: number;
    readonly mode?: "string" | "number" | "bigint";
  }) =>
    fieldOf(
      "numeric",
      mergeOptions(
        { precision: options?.precision },
        { scale: options?.scale },
        { mode: options?.mode },
      ),
    )) as FieldApi["numeric"],

  /** Alias of {@link field.numeric} — mirrors drizzle-orm (`decimal === numeric`). */
  decimal: undefined as unknown as FieldApi["decimal"],

  /** Single-precision float4 (~6 significant digits). */
  real: (() => fieldOf("real")) as FieldApi["real"],
  /** Double-precision float8 (~15 significant digits). */
  doublePrecision: (() => fieldOf("doublePrecision")) as FieldApi["doublePrecision"],

  /** Textual JSON — narrow the payload with `field.json<MyShape>()`. */
  json: (<T = unknown>() => fieldOf<T>("json")) as FieldApi["json"],
  /** Binary JSON (decomposed, indexable) — narrow with `field.jsonb<MyShape>()`. */
  jsonb: (<T = unknown>() => fieldOf<T>("jsonb")) as FieldApi["jsonb"],

  uuid: (() => fieldOf("uuid")) as FieldApi["uuid"],

  /** Time of day — always infers `string` (Drizzle `'string time'`). */
  time: ((options?: { readonly precision?: FieldPrecision; readonly withTimezone?: boolean }) =>
    fieldOf(
      "time",
      mergeOptions({ precision: options?.precision }, { withTimezone: options?.withTimezone }),
    )) as FieldApi["time"],

  /**
   * Date + time — infers `Date` objects by default; `{ mode: "string" }`
   * opts into ISO strings. OKE pins the mode explicitly when emitting
   * Drizzle schemas.
   */
  timestamp: ((options?: {
    readonly mode?: TemporalMode;
    readonly precision?: FieldPrecision;
    readonly withTimezone?: boolean;
  }) =>
    fieldOf(
      "timestamp",
      mergeOptions(
        { mode: options?.mode ?? "date" },
        { precision: options?.precision },
        { withTimezone: options?.withTimezone },
      ),
    )) as FieldApi["timestamp"],

  /** Calendar date — infers `Date` by default; `{ mode: "string" }` opts into ISO `YYYY-MM-DD`. */
  date: ((options?: { readonly mode?: TemporalMode }) =>
    fieldOf("date", mergeOptions({ mode: options?.mode ?? "date" }))) as FieldApi["date"],

  /** Time span — infers `string`. */
  interval: ((options?: { readonly fields?: IntervalField; readonly precision?: number }) =>
    fieldOf(
      "interval",
      mergeOptions({ fields: options?.fields }, { precision: options?.precision }),
    )) as FieldApi["interval"],

  /** Geometric point — `[number, number]` tuple by default; `{ mode: "xy" }` for `{ x, y }`. */
  point: ((options?: { readonly mode?: PointMode }) =>
    fieldOf("point", mergeOptions({ mode: options?.mode ?? "tuple" }))) as FieldApi["point"],

  /** Geometric line — `[n, n, n]` tuple by default; `{ mode: "abc" }` for the equation object. */
  line: ((options?: { readonly mode?: LineMode }) =>
    fieldOf("line", mergeOptions({ mode: options?.mode ?? "tuple" }))) as FieldApi["line"],

  /** Binary data — infers `Buffer` (a `Uint8Array`). */
  bytea: (() => fieldOf("bytea")) as FieldApi["bytea"],

  inet: (() => fieldOf("inet")) as FieldApi["inet"],
  cidr: (() => fieldOf("cidr")) as FieldApi["cidr"],
  macaddr: (() => fieldOf("macaddr")) as FieldApi["macaddr"],
  macaddr8: (() => fieldOf("macaddr8")) as FieldApi["macaddr8"],
} as FieldApi;

// `decimal` is the exact alias drizzle-orm ships (`export const decimal = numeric`)
// — same runtime, same overloads. Assigned post-literal because the literal
// references `field.numeric` before `field` is initialized.
(field.decimal as FieldApi["numeric"]) = field.numeric;

/** Precise public signatures for {@link field} (overloads + inference). */
interface FieldApi {
  /** Text id column with the default generation id (currently OK ID) pre-applied. */
  readonly id: () => FieldBuilder<string, false>;
  /** Text id column explicitly generated with OK ID. */
  readonly okid: () => FieldBuilder<string, false>;
  readonly text: {
    (): FieldBuilder<string, false>;
    <const E extends readonly [string, ...string[]]>(options: {
      readonly enum: E;
    }): FieldBuilder<E[number], false>;
  };
  readonly varchar: {
    (): FieldBuilder<string, false>;
    (options: { readonly length: number }): FieldBuilder<string, false>;
    <const E extends readonly [string, ...string[]]>(options: {
      readonly length?: number;
      readonly enum: E;
    }): FieldBuilder<E[number], false>;
  };
  readonly char: FieldApi["varchar"];
  readonly boolean: () => FieldBuilder<boolean, false>;
  readonly smallint: () => FieldBuilder<number, false>;
  readonly integer: () => FieldBuilder<number, false>;
  readonly bigint: {
    (): FieldBuilder<number, false>;
    (options: { readonly mode: "bigint" }): FieldBuilder<bigint, false>;
    (options: { readonly mode: "string" }): FieldBuilder<string, false>;
  };
  readonly serial: () => FieldBuilder<number, true>;
  readonly smallserial: () => FieldBuilder<number, true>;
  readonly bigserial: {
    (): FieldBuilder<number, true>;
    (options: { readonly mode: "bigint" }): FieldBuilder<bigint, true>;
  };
  readonly numeric: {
    (): FieldBuilder<string, false>;
    (options: {
      readonly precision?: number;
      readonly scale?: number;
      readonly mode?: "string";
    }): FieldBuilder<string, false>;
    (options: {
      readonly precision?: number;
      readonly scale?: number;
      readonly mode: "number";
    }): FieldBuilder<number, false>;
    (options: {
      readonly precision?: number;
      readonly scale?: number;
      readonly mode: "bigint";
    }): FieldBuilder<bigint, false>;
  };
  readonly decimal: FieldApi["numeric"];
  readonly real: () => FieldBuilder<number, false>;
  readonly doublePrecision: () => FieldBuilder<number, false>;
  readonly json: <T = unknown>() => FieldBuilder<T, false>;
  readonly jsonb: <T = unknown>() => FieldBuilder<T, false>;
  readonly uuid: () => FieldBuilder<string, false>;
  readonly time: (options?: {
    readonly precision?: FieldPrecision;
    readonly withTimezone?: boolean;
  }) => FieldBuilder<string, false>;
  readonly timestamp: {
    (options?: {
      readonly mode?: "date";
      readonly precision?: FieldPrecision;
      readonly withTimezone?: boolean;
    }): FieldBuilder<Date, false>;
    (options: {
      readonly mode: "string";
      readonly precision?: FieldPrecision;
      readonly withTimezone?: boolean;
    }): FieldBuilder<string, false>;
  };
  readonly date: {
    (options?: { readonly mode?: "date" }): FieldBuilder<Date, false>;
    (options: { readonly mode: "string" }): FieldBuilder<string, false>;
  };
  readonly interval: (options?: {
    readonly fields?: IntervalField;
    readonly precision?: number;
  }) => FieldBuilder<string, false>;
  readonly point: {
    (options?: { readonly mode?: "tuple" }): FieldBuilder<[number, number], false>;
    (options: { readonly mode: "xy" }): FieldBuilder<{ x: number; y: number }, false>;
  };
  readonly line: {
    (options?: { readonly mode?: "tuple" }): FieldBuilder<[number, number, number], false>;
    (options: { readonly mode: "abc" }): FieldBuilder<{ a: number; b: number; c: number }, false>;
  };
  readonly bytea: () => FieldBuilder<Buffer, false>;
  readonly inet: () => FieldBuilder<string, false>;
  readonly cidr: () => FieldBuilder<string, false>;
  readonly macaddr: () => FieldBuilder<string, false>;
  readonly macaddr8: () => FieldBuilder<string, false>;
}

/**
 * Merge defined per-type option entries into a {@link Partial<FieldState>}
 * patch — empty when nothing was set.
 */
function mergeOptions(
  ...parts: readonly (Partial<FieldTypeOptions> | undefined)[]
): Partial<FieldState> {
  const merged: Record<string, unknown> = {};
  for (const part of parts) {
    if (!part) continue;
    for (const [key, value] of Object.entries(part)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return Object.keys(merged).length > 0 ? { typeOptions: merged as FieldTypeOptions } : {};
}

function fieldOf<TData>(
  sqlType: FieldSqlType,
  extra: Partial<FieldState> = {},
): FieldBuilder<TData, false> {
  return createBuilder<TData, false>({
    sqlType,
    primaryKey: false,
    notNull: false,
    unique: false,
    ...extra,
  });
}

function notNullFieldOf<TData>(
  sqlType: FieldSqlType,
  extra: Partial<FieldState> = {},
): FieldBuilder<TData, true> {
  return createBuilder<TData, true>({
    sqlType,
    primaryKey: false,
    notNull: true,
    unique: false,
    ...extra,
  });
}

/**
 * Column map input for {@link schemaTable}.
 *
 * Structural over enumerated: methodful builders are invariant in their type
 * parameters, so an explicit `string | number × false | true` union would
 * reject the widened `field.*` surface (`Date`, `bigint`, tuples, generics).
 * `FieldBuilder<unknown, boolean>` accepts every builder via covariance of
 * the phantom `$infer` property.
 */
export type SchemaColumnInput = FieldBuilder<unknown, boolean> | SchemaColumnDecl;

/**
 * Whether a value is a finalized {@link SchemaColumnDecl}.
 *
 * @param value - Unknown
 */
export function isSchemaColumnDecl(value: unknown): value is SchemaColumnDecl {
  return (
    !!value &&
    typeof value === "object" &&
    "sqlType" in value &&
    "sqlName" in value &&
    "primaryKey" in value &&
    typeof (value as SchemaColumnDecl).sqlType === "string" &&
    typeof (value as SchemaColumnDecl).sqlName === "string"
  );
}

/**
 * Whether a value is a fluent {@link FieldBuilder}.
 *
 * @param value - Unknown
 */
export function isFieldBuilder(value: unknown): value is FieldBuilder {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as FieldBuilder).finalize === "function" &&
    typeof (value as FieldBuilder).primaryKey === "function" &&
    !isSchemaColumnDecl(value)
  );
}

/**
 * Finalize a column map (builders → decls).
 *
 * @param columns - Key → builder or decl
 */
export function finalizeColumnMap(
  columns: Readonly<Record<string, SchemaColumnInput>>,
): Record<string, SchemaColumnDecl> {
  const out: Record<string, SchemaColumnDecl> = {};
  for (const [key, value] of Object.entries(columns)) {
    out[key] = isFieldBuilder(value) ? value.finalize(key) : (value as SchemaColumnDecl);
  }
  return out;
}

/**
 * Whether a value is a {@link SchemaTableDecl}.
 *
 * @param value - Unknown
 */
export function isSchemaTableDecl(value: unknown): value is SchemaTableDecl {
  if (!value || typeof value !== "object") return false;
  const table = value as SchemaTableDecl;
  if (table.kind !== "schema-table" || !("columns" in table)) return false;
  return typeof schemaTableSqlName(table) === "string";
}

/**
 * SQL name for a {@link SchemaTableDecl}, including tables whose `name`
 * column shadows {@link TableHandle.name}.
 *
 * @param table - Schema table declaration
 */
export function schemaTableSqlName(table: SchemaTableDecl): string | undefined {
  if (typeof table.tableName === "string") return table.tableName;
  if (typeof table.name === "string") return table.name;
  for (const col of Object.values(table.columns ?? {})) {
    if (typeof col.tableName === "string") return col.tableName;
  }
  return undefined;
}

/**
 * JS value type for a finalized column (`string` / `number`, plus `| null`
 * when the column is nullable).
 */
export type InferColumnJs<C> =
  C extends SchemaColumnDecl<infer D, infer N> ? (N extends true ? D : D | null) : unknown;

/**
 * Finalize a {@link schemaTable} column input into a typed decl.
 */
export type FinalizeColumn<T> =
  T extends FieldBuilder<infer D, infer N>
    ? SchemaColumnDecl<D, N>
    : T extends SchemaColumnDecl<infer D, infer N>
      ? SchemaColumnDecl<D, N>
      : SchemaColumnDecl;

/**
 * Table decl with columns as own properties (`links.code`) for FK / relations.
 *
 * `$inferSelect` is type-level only (Drizzle's own alias) — not set at runtime.
 */
export type SchemaTableWithColumns<
  C extends Record<string, SchemaColumnDecl> = Record<string, SchemaColumnDecl>,
> = Omit<SchemaTableDecl, "columns"> & {
  readonly columns: Readonly<C>;
  readonly $inferSelect: { [K in keyof C]: InferColumnJs<C[K]> };
} & Omit<C, "kind" | "tableName" | "$inferSelect">;

/**
 * Declare an abstract schema table (ORM-agnostic).
 *
 * Columns are also exposed as own properties (`links.code`) for
 * `.references(() => links.code)` ergonomics matching Drizzle.
 *
 * @param name - SQL table name
 * @param columns - Column map using {@link field} builders
 * @param extras - RLS enable + {@link schemaPolicy} extras (Drizzle third arg)
 */
export function schemaTable<C extends Record<string, SchemaColumnInput>>(
  name: string,
  columns: C,
  extras: readonly SchemaTableExtra[] = [],
): SchemaTableWithColumns<{ [K in keyof C]: FinalizeColumn<C[K]> }> {
  const finalized = finalizeColumnMap(columns);
  const stamped: Record<string, SchemaColumnDecl> = {};
  for (const [key, col] of Object.entries(finalized)) {
    stamped[key] = { ...col, tableName: name };
  }
  const policies = extras.filter(
    (extra): extra is SchemaPolicyDecl => extra.kind === "schema-policy",
  );
  const rls = extras.some((extra) => extra.kind === "schema-rls") || policies.length > 0;
  const unscoped = extras.some(
    (extra) => extra.kind === "schema-tenant-scoped" && extra.tenantScoped === false,
  );
  const table = {
    name,
    columns: stamped,
    ...stamped,
    ...(rls ? { rls: true } : {}),
    ...(policies.length > 0 ? { policies } : {}),
    ...(unscoped ? { tenantScoped: false } : {}),
  };
  // Survive columns named `name` or `kind` (they would otherwise shadow
  // the table discriminant / SQL name).
  Object.defineProperty(table, "kind", { value: "schema-table", enumerable: false });
  Object.defineProperty(table, "tableName", { value: name, enumerable: false });
  return table as SchemaTableWithColumns<{ [K in keyof C]: FinalizeColumn<C[K]> }>;
}

/**
 * Enable RLS with no policies (`pgTable.withRLS`).
 */
export function schemaRls(): SchemaRlsEnableDecl {
  return { kind: "schema-rls" };
}

/**
 * Raw Drizzle-shaped policy extra.
 *
 * @param name - Policy name
 * @param options - `as` / `to` / `for` / `using` / `withCheck`
 */
export function schemaPolicy(name: string, options: SchemaPolicyOptions = {}): SchemaPolicyDecl {
  return {
    kind: "schema-policy",
    name,
    ...(options.as !== undefined ? { as: options.as } : {}),
    ...(options.to !== undefined ? { to: options.to } : {}),
    ...(options.for !== undefined ? { for: options.for } : {}),
    ...(options.using !== undefined ? { using: options.using } : {}),
    ...(options.withCheck !== undefined ? { withCheck: options.withCheck } : {}),
  };
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Policy name `prefix_key_command`.
 *
 * @param prefix - Helper kind
 * @param key - Gate / column / scope
 * @param command - SQL command
 */
export function helperPolicyName(prefix: string, key: string, command: SchemaPolicyFor): string {
  const slug = key.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `${prefix}_${slug}_${command}`;
}

/**
 * USING / WITH CHECK split for a helper expression.
 *
 * @param command - SQL command
 * @param expr - Predicate
 */
export function policyPredicates(
  command: SchemaPolicyFor,
  expr: string,
): { readonly using?: string; readonly withCheck?: string } {
  if (command === "insert") return { withCheck: expr };
  if (command === "update" || command === "all") return { using: expr, withCheck: expr };
  return { using: expr };
}

/**
 * Gate-name policy — `oke.gate() = 'member'`.
 *
 * @param gate - Policy / public Gate name
 * @param options - Command (default `select`)
 */
export function schemaPolicyGate(
  gate: string,
  options: Pick<SchemaPolicyOptions, "for" | "as" | "to"> = {},
): SchemaPolicyDecl {
  const command = options.for ?? "select";
  return schemaPolicy(helperPolicyName("gate", gate, command), {
    ...options,
    for: command,
    ...policyPredicates(command, `oke.gate() = ${sqlStringLiteral(gate)}`),
  });
}

/**
 * Owner-column policy — `owner = oke.user()`.
 *
 * @param column - SQL / JS column name
 * @param options - Command (default `all`)
 */
export function schemaPolicyOwner(
  column: string,
  options: Pick<SchemaPolicyOptions, "for" | "as" | "to"> = {},
): SchemaPolicyDecl {
  const command = options.for ?? "all";
  return schemaPolicy(helperPolicyName("owner", column, command), {
    ...options,
    for: command,
    ...policyPredicates(command, `${column} = oke.user()`),
  });
}

/**
 * Scope policy — `oke.has_scope('booking:create')`.
 *
 * Accepts a bare scope string or a `gate.scope(...)` declaration; the decl
 * form keeps the scope string single-sourced (TS catches dangling gate refs).
 *
 * @param scope - Scope string or `PolicyGateDecl` from `gate.scope(...)`
 * @param options - Command (default `insert`)
 */
export function schemaPolicyScope(
  scope: string | PolicyGateDecl,
  options: Pick<SchemaPolicyOptions, "for" | "as" | "to"> = {},
): SchemaPolicyDecl {
  const resolved = typeof scope === "string" ? scope : (scope.scopes?.[0] ?? scope.name);
  const command = options.for ?? "insert";
  return schemaPolicy(helperPolicyName("scope", resolved, command), {
    ...options,
    for: command,
    ...policyPredicates(command, `oke.has_scope(${sqlStringLiteral(resolved)})`),
  });
}

/** Callable `store.schema.policy` plus Gate helpers. */
export type SchemaPolicyApi = typeof schemaPolicy & {
  readonly gate: typeof schemaPolicyGate;
  readonly owner: typeof schemaPolicyOwner;
  readonly scope: typeof schemaPolicyScope;
  readonly tenant: (
    column: string,
    options?: Pick<SchemaPolicyOptions, "for" | "as" | "to">,
  ) => SchemaPolicyDecl;
};

function loadSchemaTenant(): {
  tenant: SchemaPolicyApi["tenant"];
  unscoped: () => SchemaTenantScopedDecl;
} {
  return lazyRequire(import.meta.dir, ["schema", "tenant"].join("-"));
}

/**
 * Tenant-column policy — `tenant_id = oke.tenant()`.
 *
 * @param column - SQL / JS column name
 * @param options - Command (default `all`)
 */
export function schemaPolicyTenant(
  column: string,
  options: Pick<SchemaPolicyOptions, "for" | "as" | "to"> = {},
): SchemaPolicyDecl {
  return loadSchemaTenant().tenant(column, options);
}

/**
 * Mark a table as globally shared (`tenantScoped: false`).
 * Required when `gate.auth.tenant` is on and the table has no tenant policy.
 */
export function schemaUnscoped(): SchemaTenantScopedDecl {
  return loadSchemaTenant().unscoped();
}

/** `store.schema.policy` — raw + Gate helpers. */
export const schemaPolicyApi: SchemaPolicyApi = Object.assign(schemaPolicy, {
  gate: schemaPolicyGate,
  owner: schemaPolicyOwner,
  scope: schemaPolicyScope,
  tenant: schemaPolicyTenant,
});

// ─── Relations (mirrors drizzle-orm `defineRelations`) ───────────────────────

/** Column path recorded by relation helpers (`r.links.code`). */
export interface RelationColumnRef {
  readonly table: string;
  readonly column: string;
}

/** One relation config (serializable for emit). */
export interface SchemaRelationOne {
  readonly kind: "one";
  readonly target: string;
  readonly from?: RelationColumnRef | readonly RelationColumnRef[];
  readonly to?: RelationColumnRef | readonly RelationColumnRef[];
  readonly optional?: boolean;
  readonly alias?: string;
}

/** Many relation config (serializable for emit). */
export interface SchemaRelationMany {
  readonly kind: "many";
  readonly target: string;
  readonly from?: RelationColumnRef | readonly RelationColumnRef[];
  readonly to?: RelationColumnRef | readonly RelationColumnRef[];
  readonly alias?: string;
}

/** One named relation on a source table. */
export type SchemaRelationEntry = SchemaRelationOne | SchemaRelationMany;

/** Per-table relation map. */
export type SchemaTableRelations = Readonly<Record<string, SchemaRelationEntry>>;

/** Full relations declaration from {@link schemaRelations}. */
export interface SchemaRelationsDecl {
  readonly kind: "schema-relations";
  /** Export names of tables passed to {@link schemaRelations}. */
  readonly tableKeys: readonly string[];
  /** Table export name → relation name → config. */
  readonly config: Readonly<Record<string, SchemaTableRelations>>;
}

/** Config input for one/many helpers. */
export interface RelationHelperConfig {
  readonly from?: RelationColumnRef | readonly RelationColumnRef[];
  readonly to?: RelationColumnRef | readonly RelationColumnRef[];
  readonly optional?: boolean;
  readonly alias?: string;
}

type RelationTableCols = Record<string, RelationColumnRef> & {
  readonly __table: string;
};

type RelationsBuilderFor<Keys extends string> = {
  readonly [K in Keys]: RelationTableCols;
} & {
  readonly one: {
    readonly [K in Keys]: (config?: RelationHelperConfig) => SchemaRelationOne;
  };
  readonly many: {
    readonly [K in Keys]: (config?: RelationHelperConfig) => SchemaRelationMany;
  };
};

/** Untyped relations builder (emit / dynamic paths). */
type RelationsBuilder = RelationsBuilderFor<string>;

/**
 * Whether a value is a {@link SchemaRelationsDecl}.
 *
 * @param value - Unknown
 */
export function isSchemaRelationsDecl(value: unknown): value is SchemaRelationsDecl {
  return (
    !!value &&
    typeof value === "object" &&
    (value as SchemaRelationsDecl).kind === "schema-relations" &&
    Array.isArray((value as SchemaRelationsDecl).tableKeys) &&
    typeof (value as SchemaRelationsDecl).config === "object"
  );
}

function columnRefFrom(value: unknown): RelationColumnRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const col = value as SchemaColumnDecl & RelationColumnRef;
  if (typeof col.table === "string" && typeof col.column === "string") {
    return { table: col.table, column: col.column };
  }
  if (isSchemaColumnDecl(col) && typeof col.tableName === "string" && typeof col.key === "string") {
    return { table: col.tableName, column: col.key };
  }
  return undefined;
}

function normalizeColRefs(
  value: RelationColumnRef | readonly RelationColumnRef[] | undefined,
): RelationColumnRef | readonly RelationColumnRef[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    const out: RelationColumnRef[] = [];
    for (const item of value) {
      const ref = columnRefFrom(item) ?? (item as RelationColumnRef);
      if (ref?.table && ref?.column) out.push({ table: ref.table, column: ref.column });
    }
    return out.length === 1 ? out[0] : out;
  }
  return columnRefFrom(value) ?? value;
}

/**
 * Build recording helpers isomorphic to drizzle-orm `defineRelations` helpers.
 *
 * @param tableKeys - Export names of tables in the schema object
 * @param tables - Table decls keyed by export name
 */
function createRelationsBuilder(
  tableKeys: readonly string[],
  tables: Readonly<Record<string, SchemaTableDecl>>,
): RelationsBuilder {
  const builder: Record<string, unknown> = {};

  for (const key of tableKeys) {
    const table = tables[key];
    if (!table) continue;
    const cols = { __table: table.name } as RelationTableCols;
    for (const [colKey] of Object.entries(table.columns)) {
      cols[colKey] = { table: key, column: colKey };
    }
    builder[key] = cols;
  }

  const one: Record<string, (config?: RelationHelperConfig) => SchemaRelationOne> = {};
  const many: Record<string, (config?: RelationHelperConfig) => SchemaRelationMany> = {};

  for (const key of tableKeys) {
    one[key] = (config) => ({
      kind: "one",
      target: key,
      ...(config?.from !== undefined ? { from: normalizeColRefs(config.from) } : {}),
      ...(config?.to !== undefined ? { to: normalizeColRefs(config.to) } : {}),
      ...(config?.optional !== undefined ? { optional: config.optional } : {}),
      ...(config?.alias !== undefined ? { alias: config.alias } : {}),
    });
    many[key] = (config) => ({
      kind: "many",
      target: key,
      ...(config?.from !== undefined ? { from: normalizeColRefs(config.from) } : {}),
      ...(config?.to !== undefined ? { to: normalizeColRefs(config.to) } : {}),
      ...(config?.alias !== undefined ? { alias: config.alias } : {}),
    });
  }

  builder.one = one;
  builder.many = many;
  return builder as RelationsBuilder;
}

/**
 * Declare abstract relations — mirrors drizzle-orm `defineRelations` shape.
 *
 * @param tables - Schema object of {@link SchemaTableDecl}s (export-name keys)
 * @param configure - `(r) => ({ links: { daily: r.many.daily({ from, to }) } })`
 */
export function schemaRelations<T extends Readonly<Record<string, SchemaTableDecl>>>(
  tables: T,
  configure: (
    r: RelationsBuilderFor<Extract<keyof T, string>>,
  ) => Readonly<Record<string, SchemaTableRelations | undefined>>,
): SchemaRelationsDecl {
  const tableKeys = Object.keys(tables).filter((k) => isSchemaTableDecl(tables[k]));
  const tableMap: Record<string, SchemaTableDecl> = {};
  for (const k of tableKeys) {
    tableMap[k] = tables[k]!;
  }
  const builder = createRelationsBuilder(tableKeys, tableMap) as RelationsBuilderFor<
    Extract<keyof T, string>
  >;
  const raw = configure(builder);
  const config: Record<string, SchemaTableRelations> = {};
  for (const [tableKey, rels] of Object.entries(raw)) {
    if (!rels) continue;
    config[tableKey] = rels;
  }
  return {
    kind: "schema-relations",
    tableKeys,
    config,
  };
}

/** `store.schema` namespace — avoids colliding with {@link SqlStoreDecl.table} CDC. */
export const schema = {
  table: schemaTable,
  relations: schemaRelations,
  rls: schemaRls,
  policy: schemaPolicyApi,
  unscoped: schemaUnscoped,
} as const;

/**
 * Collect {@link SchemaTableDecl} values from a module's exports.
 *
 * @param mod - Module namespace object
 */
export function tablesFromExports(mod: Readonly<Record<string, unknown>>): SchemaTableDecl[] {
  const out: SchemaTableDecl[] = [];
  for (const value of Object.values(mod)) {
    if (isSchemaTableDecl(value)) out.push(value);
  }
  return out;
}

/**
 * Collect {@link SchemaRelationsDecl} values from a module's exports.
 *
 * @param mod - Module namespace object
 */
export function relationsFromExports(
  mod: Readonly<Record<string, unknown>>,
): SchemaRelationsDecl[] {
  const out: SchemaRelationsDecl[] = [];
  for (const value of Object.values(mod)) {
    if (isSchemaRelationsDecl(value)) out.push(value);
  }
  return out;
}
