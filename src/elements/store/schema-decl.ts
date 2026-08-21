/**
 * Abstract store schema — ORM-agnostic declare site (`field.*` + `store.schema.table`).
 *
 * Survey-backed v1 primitives: `text` · `integer` + modifiers + PII tags + FKs.
 * Dialect-specific Drizzle is emitted separately ({@link emitDrizzleSource}).
 */

import type { ColumnClassification } from "../../manifest/types.ts";
import type { ColumnDef, TableHandle } from "./table.ts";
import { id as idHelper, now as nowHelper } from "./table.ts";

/** SQL type primitives supported in v1. */
export type FieldSqlType = "text" | "integer";

/** Known `$defaultFn` helpers recognized by the Drizzle emitter. */
export type DefaultFnKind = "id" | "now" | "custom";

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
 */
export interface SchemaColumnDecl extends ColumnDef {
  /** JS object key (e.g. `createdAt`). */
  readonly key: string;
  /** Database column name (e.g. `created_at`). */
  readonly sqlName: string;
  /** Declared SQL type. */
  readonly sqlType: FieldSqlType;
  readonly primaryKey: boolean;
  readonly notNull: boolean;
  readonly unique: boolean;
  /** Literal `.default(v)` when set. */
  readonly defaultValue?: string | number | boolean | null;
  /** Runtime default applied on insert when the key is missing. */
  readonly defaultFn?: () => unknown;
  /** Emitter hint for `$defaultFn(id|now)`. */
  readonly defaultFnKind?: DefaultFnKind;
  /** Owning table SQL name (stamped by {@link schemaTable}). */
  readonly tableName?: string;
  /** Foreign key when `.references()` was used. */
  readonly references?: ColumnReference;
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

/** Third-arg extra for {@link schemaTable}. */
export type SchemaTableExtra = SchemaPolicyDecl | SchemaRlsEnableDecl;

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
}

/** Fluent field builder before key finalization. */
export interface FieldBuilder {
  primaryKey(): FieldBuilder;
  notNull(): FieldBuilder;
  unique(): FieldBuilder;
  default(value: string | number | boolean | null): FieldBuilder;
  defaultFn(fn: () => unknown): FieldBuilder;
  pii(): FieldBuilder;
  sensitive(): FieldBuilder;
  retain(duration: string): FieldBuilder;
  /** Override snake_case SQL name. */
  as(sqlName: string): FieldBuilder;
  /** Optional human description for Console / docs (falls back to the JS key). */
  describe(description: string): FieldBuilder;
  /**
   * Declare a foreign key to another column (dialect-agnostic).
   *
   * @param ref - Lazy target column (`() => links.code`)
   * @param actions - Optional ON DELETE / ON UPDATE
   */
  references(ref: () => SchemaColumnDecl, actions?: ReferenceActions): FieldBuilder;
  /**
   * Bind the JS key and produce a {@link SchemaColumnDecl}.
   *
   * @param key - Object key in the table column map
   */
  finalize(key: string): SchemaColumnDecl;
}

interface FieldState {
  readonly sqlType: FieldSqlType;
  readonly primaryKey: boolean;
  readonly notNull: boolean;
  readonly unique: boolean;
  readonly defaultValue?: string | number | boolean | null;
  readonly defaultFn?: () => unknown;
  readonly defaultFnKind?: DefaultFnKind;
  readonly classification?: ColumnClassification;
  readonly sqlName?: string;
  readonly description?: string;
  readonly references?: ColumnReference;
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
  const name = typeof fn.name === "string" ? fn.name : "";
  if (name === "id") return "id";
  if (name === "now") return "now";
  return "custom";
}

function mergeClassification(
  current: ColumnClassification | undefined,
  patch: ColumnClassification,
): ColumnClassification {
  return { ...(current ?? {}), ...patch };
}

function createBuilder(state: FieldState): FieldBuilder {
  const next = (patch: Partial<FieldState>): FieldBuilder => createBuilder({ ...state, ...patch });

  return {
    primaryKey: () => next({ primaryKey: true, notNull: true }),
    notNull: () => next({ notNull: true }),
    unique: () => next({ unique: true }),
    default: (value) => next({ defaultValue: value }),
    defaultFn: (fn) =>
      next({
        defaultFn: fn,
        defaultFnKind: defaultFnKindOf(fn),
      }),
    pii: () => next({ classification: mergeClassification(state.classification, { pii: true }) }),
    sensitive: () =>
      next({ classification: mergeClassification(state.classification, { sensitive: true }) }),
    retain: (duration) =>
      next({ classification: mergeClassification(state.classification, { retain: duration }) }),
    as: (sqlName) => next({ sqlName }),
    describe: (description) => next({ description }),
    references: (ref, actions) =>
      next({
        references: actions ? { ref, actions } : { ref },
      }),
    finalize(key: string): SchemaColumnDecl {
      const sqlName = state.sqlName ?? camelToSnake(key);
      return {
        key,
        name: sqlName,
        sqlName,
        sqlType: state.sqlType,
        primaryKey: state.primaryKey,
        notNull: state.notNull || state.primaryKey,
        unique: state.unique,
        ...(state.defaultValue !== undefined ? { defaultValue: state.defaultValue } : {}),
        ...(state.defaultFn ? { defaultFn: state.defaultFn } : {}),
        ...(state.defaultFnKind ? { defaultFnKind: state.defaultFnKind } : {}),
        ...(state.classification ? { classification: state.classification } : {}),
        ...(state.description !== undefined ? { description: state.description } : {}),
        ...(state.references ? { references: state.references } : {}),
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
 * Field builders — `field.text()` / `field.integer()`.
 */
export const field = {
  text: (): FieldBuilder =>
    createBuilder({
      sqlType: "text",
      primaryKey: false,
      notNull: false,
      unique: false,
    }),
  integer: (): FieldBuilder =>
    createBuilder({
      sqlType: "integer",
      primaryKey: false,
      notNull: false,
      unique: false,
    }),
} as const;

/** Column map input for {@link schemaTable}. */
export type SchemaColumnInput = FieldBuilder | SchemaColumnDecl;

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
    out[key] = isFieldBuilder(value) ? value.finalize(key) : value;
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
 * Table decl with columns as own properties (`links.code`) for FK / relations.
 */
export type SchemaTableWithColumns<
  C extends Record<string, SchemaColumnDecl> = Record<string, SchemaColumnDecl>,
> = Omit<SchemaTableDecl, "columns"> & {
  readonly columns: Readonly<C>;
} & Omit<C, "kind" | "tableName">;

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
): SchemaTableWithColumns<{ [K in keyof C]: SchemaColumnDecl }> {
  const finalized = finalizeColumnMap(columns);
  const stamped: Record<string, SchemaColumnDecl> = {};
  for (const [key, col] of Object.entries(finalized)) {
    stamped[key] = { ...col, tableName: name };
  }
  const policies = extras.filter(
    (extra): extra is SchemaPolicyDecl => extra.kind === "schema-policy",
  );
  const rls = extras.some((extra) => extra.kind === "schema-rls") || policies.length > 0;
  const table = {
    name,
    columns: stamped,
    ...stamped,
    ...(rls ? { rls: true } : {}),
    ...(policies.length > 0 ? { policies } : {}),
  };
  // Survive columns named `name` or `kind` (they would otherwise shadow
  // the table discriminant / SQL name).
  Object.defineProperty(table, "kind", { value: "schema-table", enumerable: false });
  Object.defineProperty(table, "tableName", { value: name, enumerable: false });
  return table as SchemaTableWithColumns<{ [K in keyof C]: SchemaColumnDecl }>;
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

function helperPolicyName(prefix: string, key: string, command: SchemaPolicyFor): string {
  const slug = key.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `${prefix}_${slug}_${command}`;
}

function policyPredicates(
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
 * @param scope - Scope string
 * @param options - Command (default `insert`)
 */
export function schemaPolicyScope(
  scope: string,
  options: Pick<SchemaPolicyOptions, "for" | "as" | "to"> = {},
): SchemaPolicyDecl {
  const command = options.for ?? "insert";
  return schemaPolicy(helperPolicyName("scope", scope, command), {
    ...options,
    for: command,
    ...policyPredicates(command, `oke.has_scope(${sqlStringLiteral(scope)})`),
  });
}

/** Callable `store.schema.policy` plus Gate helpers. */
export type SchemaPolicyApi = typeof schemaPolicy & {
  readonly gate: typeof schemaPolicyGate;
  readonly owner: typeof schemaPolicyOwner;
  readonly scope: typeof schemaPolicyScope;
};

/** `store.schema.policy` — raw + Gate helpers. */
export const schemaPolicyApi: SchemaPolicyApi = Object.assign(schemaPolicy, {
  gate: schemaPolicyGate,
  owner: schemaPolicyOwner,
  scope: schemaPolicyScope,
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
