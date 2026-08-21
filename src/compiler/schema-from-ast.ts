/**
 * Expand flow `in` / `out` AST into Manifest JSON Schema.
 *
 * Covers handwritten `z.object({…})` and `drizzle-orm/zod`
 * (`createSelectSchema` / `createInsertSchema` / `createUpdateSchema`,
 * plus Keel's `tableZod(table).select|insert|update`). Opaque identifiers
 * stay `"…"` at the call site.
 *
 * @see https://orm.drizzle.team/docs/zod
 */

import type { DeclaredColumn } from "../manifest/types.ts";
import {
  identifierName,
  stringArg,
  type AstNode,
  type CallExpression,
  type Identifier,
  type InferBinding,
  type Literal,
} from "./effects-infer.ts";

/** Table columns already extracted from `store.schema.table`. */
export type SchemaTableColumns = Record<string, DeclaredColumn>;

/** One `const Name = <init>` and the file it was declared in. */
export type ConstInit = {
  readonly node: AstNode;
  readonly file: string;
};

/** Bindings the expander may follow. */
export interface SchemaExpandContext {
  /** File that contains the expression being expanded. */
  readonly filePath: string;
  /**
   * Resolve `const Name` — same-file first, then a unique project-wide
   * export. Shared names like `createIn` must not leak across units.
   *
   * @param name - Binding name
   * @param fromFile - File of the referring expression
   */
  readonly resolveConst: (name: string, fromFile: string) => ConstInit | undefined;
  /** Store / table bindings (`spaces` → table name). */
  readonly bindings: ReadonlyMap<string, InferBinding>;
  /**
   * Columns for a table binding or SQL name.
   *
   * @param name - Binding (`spaces`) or table (`spaces`)
   */
  readonly tableColumns: (name: string) => SchemaTableColumns | undefined;
}

const DRIZZLE_SCHEMA_FNS = {
  createSelectSchema: "select",
  createInsertSchema: "insert",
  createUpdateSchema: "update",
} as const;

type DrizzleShape = (typeof DRIZZLE_SCHEMA_FNS)[keyof typeof DRIZZLE_SCHEMA_FNS];

const LIST_IN_PROPERTIES: Record<string, Record<string, unknown>> = {
  q: { type: "string" },
  search: { type: "string" },
  limit: { type: "integer", minimum: 1, maximum: 100 },
  order: { type: "string" },
  orderBy: { type: "string" },
  select: { type: "string" },
  or: { type: "string" },
  and: { type: "string" },
  offset: { type: "integer", minimum: 0 },
  cursor: { type: "string" },
};

const MAX_DEPTH = 24;

/**
 * Expand a schema expression to a JSON Schema object, or `undefined`
 * when the node is opaque (fixture placeholder, unknown helper).
 *
 * @param node - `in` / `out` AST
 * @param ctx - Const inits + table columns
 */
export function jsonSchemaFromAst(
  node: AstNode | undefined,
  ctx: SchemaExpandContext,
): Record<string, unknown> | undefined {
  return expand(node, ctx, new Set(), 0);
}

/**
 * JSON Schema object for a `store.schema.table` under drizzle-orm/zod rules.
 *
 * - **select** — every column; `notNull` columns are required
 * - **insert** — omit generated primary keys; required = not-null without default
 * - **update** — every mutable column, all optional
 *
 * @param columns - Declared columns
 * @param shape - drizzle-orm/zod factory
 */
export function jsonSchemaFromTableColumns(
  columns: SchemaTableColumns,
  shape: DrizzleShape,
): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const [name, col] of Object.entries(columns)) {
    if (shape !== "select" && isGeneratedPrimaryKey(col)) continue;
    properties[name] = columnToProperty(col);
    if (shape === "select" && col.nullable === false) required.push(name);
    if (shape === "insert" && col.nullable === false && !columnHasDefault(col)) {
      required.push(name);
    }
  }
  return objectSchema(properties, required);
}

function expand(
  node: AstNode | undefined,
  ctx: SchemaExpandContext,
  seen: Set<string>,
  depth: number,
): Record<string, unknown> | undefined {
  if (!node || depth > MAX_DEPTH) return undefined;
  const unwrapped = unwrapTsExpr(node);

  if (unwrapped.type === "Identifier") {
    const name = (unwrapped as Identifier).name;
    if (seen.has(name)) return undefined;
    const next = new Set(seen);
    next.add(name);
    const init = ctx.resolveConst(name, ctx.filePath);
    if (init) return expand(init.node, { ...ctx, filePath: init.file }, next, depth + 1);
    return undefined;
  }

  if (unwrapped.type === "MemberExpression") {
    const member = unwrapped as AstNode & { object: AstNode; property: AstNode };
    const prop = identifierName(member.property);
    const drizzle = drizzleShapeFromMember(member, ctx, seen, depth);
    if (drizzle) return drizzle;
    if (prop === "shape" || prop === "def") {
      return expand(member.object, ctx, seen, depth + 1);
    }
    return undefined;
  }

  if (unwrapped.type !== "CallExpression") return undefined;
  return expandCall(unwrapped as CallExpression, ctx, seen, depth);
}

function expandCall(
  call: CallExpression,
  ctx: SchemaExpandContext,
  seen: Set<string>,
  depth: number,
): Record<string, unknown> | undefined {
  const callee = unwrapTsExpr(call.callee);
  const fnName = identifierName(callee);

  if (fnName && fnName in DRIZZLE_SCHEMA_FNS) {
    const shape = DRIZZLE_SCHEMA_FNS[fnName as keyof typeof DRIZZLE_SCHEMA_FNS];
    return expandDrizzleFactory(call, shape, ctx, seen, depth);
  }
  if (fnName === "tableZod") {
    const table = resolveTableName(call.arguments[0], ctx);
    if (!table) return undefined;
    const cols = ctx.tableColumns(table);
    return cols ? jsonSchemaFromTableColumns(cols, "select") : undefined;
  }
  if (fnName === "listIn") return expandListIn(call, ctx, seen, depth);
  if (fnName === "pageOut" || fnName === "listPage") {
    const items = expand(call.arguments[0], ctx, seen, depth + 1);
    return items ? { type: "array", items } : undefined;
  }

  if (callee.type !== "MemberExpression") return undefined;
  const member = callee as AstNode & { object: AstNode; property: AstNode };
  const method = identifierName(member.property);
  if (!method) return undefined;

  if (identifierName(member.object) === "z") {
    return expandZodRoot(method, call, ctx, seen, depth);
  }

  const inner = expand(member.object, ctx, seen, depth + 1);
  if (!inner) return undefined;
  return applyZodMethod(inner, method, call, ctx, seen, depth);
}

function expandZodRoot(
  method: string,
  call: CallExpression,
  ctx: SchemaExpandContext,
  seen: Set<string>,
  depth: number,
): Record<string, unknown> | undefined {
  if (method === "object") {
    const propsNode = objectArg(call.arguments[0]);
    if (!propsNode) return { type: "object", properties: {} };
    return objectFromZodProps(propsNode, ctx, seen, depth);
  }
  if (method === "array") {
    const items = expand(call.arguments[0], ctx, seen, depth + 1);
    return items ? { type: "array", items } : { type: "array" };
  }
  if (method === "enum") {
    const values = stringArrayArg(call.arguments[0]);
    return values ? { type: "string", enum: values } : { type: "string" };
  }
  if (method === "literal") {
    const value = literalValue(call.arguments[0]);
    if (value === undefined) return undefined;
    return { const: value, type: literalJsonType(value) };
  }
  if (method === "intersection") {
    const left = expand(call.arguments[0], ctx, seen, depth + 1);
    const right = expand(call.arguments[1], ctx, seen, depth + 1);
    if (!left && !right) return undefined;
    return mergeObjects(left, right);
  }
  if (method === "union" || method === "discriminatedUnion") return undefined;
  return leafFromZodType(method);
}

function applyZodMethod(
  schema: Record<string, unknown>,
  method: string,
  call: CallExpression,
  ctx: SchemaExpandContext,
  seen: Set<string>,
  depth: number,
): Record<string, unknown> | undefined {
  if (
    method === "optional" ||
    method === "nullable" ||
    method === "nullish" ||
    method === "default" ||
    method === "catch" ||
    method === "readonly" ||
    method === "brand" ||
    method === "describe" ||
    method === "meta" ||
    method === "refine" ||
    method === "superRefine" ||
    method === "transform" ||
    method === "pipe" ||
    method === "passthrough" ||
    method === "strict" ||
    method === "strip" ||
    method === "catchall"
  ) {
    if (method === "describe") {
      const text = stringArg(call.arguments[0]);
      return text ? { ...schema, description: text } : schema;
    }
    return schema;
  }
  if (method === "min") {
    const n = numberArg(call.arguments[0]);
    if (n === undefined) return schema;
    return schema.type === "string" ? { ...schema, minLength: n } : { ...schema, minimum: n };
  }
  if (method === "max") {
    const n = numberArg(call.arguments[0]);
    if (n === undefined) return schema;
    return schema.type === "string" ? { ...schema, maxLength: n } : { ...schema, maximum: n };
  }
  if (method === "length") {
    const n = numberArg(call.arguments[0]);
    return n === undefined ? schema : { ...schema, minLength: n, maxLength: n };
  }
  if (method === "int") return { ...schema, type: "integer" };
  if (method === "email") return { ...schema, type: "string", format: "email" };
  if (method === "uuid") return { ...schema, type: "string", format: "uuid" };
  if (method === "url") return { ...schema, type: "string", format: "uri" };
  if (method === "datetime") return { ...schema, type: "string", format: "date-time" };
  if (method === "pick") return pickOmit(schema, call.arguments[0], "pick");
  if (method === "omit") return pickOmit(schema, call.arguments[0], "omit");
  if (method === "extend") {
    const extra = objectArg(call.arguments[0]);
    if (!extra) return schema;
    return mergeObjects(schema, objectFromZodProps(extra, ctx, seen, depth));
  }
  if (method === "partial") {
    const { required: _req, ...rest } = schema;
    return rest;
  }
  return schema;
}

function expandDrizzleFactory(
  call: CallExpression,
  shape: DrizzleShape,
  ctx: SchemaExpandContext,
  seen: Set<string>,
  depth: number,
): Record<string, unknown> | undefined {
  const table = resolveTableName(call.arguments[0], ctx);
  if (!table) return undefined;
  const cols = ctx.tableColumns(table);
  if (!cols) return undefined;
  const base = jsonSchemaFromTableColumns(cols, shape);
  const refine = objectArg(call.arguments[1]);
  if (!refine) return base;
  return applyDrizzleRefinements(base, refine, ctx, seen, depth);
}

/**
 * Second-arg refinements: a Zod schema overwrites the field (docs);
 * a callback is ignored (we cannot apply `.max()` without the inner schema).
 */
function applyDrizzleRefinements(
  base: Record<string, unknown>,
  refine: AstNode,
  ctx: SchemaExpandContext,
  seen: Set<string>,
  depth: number,
): Record<string, unknown> {
  const properties = { ...((base.properties as Record<string, Record<string, unknown>>) ?? {}) };
  const required = Array.isArray(base.required) ? [...(base.required as string[])] : [];
  for (const prop of objectProperties(refine)) {
    const key = propKey(prop);
    const value = (prop as AstNode & { value?: AstNode }).value;
    if (!key || !value) continue;
    if (value.type === "ArrowFunctionExpression" || value.type === "FunctionExpression") {
      continue;
    }
    const overwritten = expand(value, ctx, seen, depth + 1);
    if (!overwritten) continue;
    properties[key] = overwritten;
    if (!("const" in overwritten) && overwritten.type !== undefined && !required.includes(key)) {
      // Overwrite replaces nullability (docs) — keep required if the replacement
      // is a non-optional object field we cannot see `.optional()` on.
    }
  }
  return objectSchema(
    properties,
    required.filter((name) => name in properties),
  );
}

function drizzleShapeFromMember(
  member: AstNode & { object: AstNode; property: AstNode },
  ctx: SchemaExpandContext,
  seen: Set<string>,
  depth: number,
): Record<string, unknown> | undefined {
  const prop = identifierName(member.property);
  if (prop !== "select" && prop !== "insert" && prop !== "update") return undefined;
  const table = tableZodTable(member.object, ctx, seen, depth);
  if (!table) return undefined;
  const cols = ctx.tableColumns(table);
  return cols ? jsonSchemaFromTableColumns(cols, prop) : undefined;
}

function tableZodTable(
  node: AstNode,
  ctx: SchemaExpandContext,
  seen: Set<string>,
  depth: number,
): string | undefined {
  const unwrapped = unwrapTsExpr(node);
  if (unwrapped.type === "Identifier") {
    const name = (unwrapped as Identifier).name;
    if (seen.has(`zod:${name}`)) return undefined;
    const init = ctx.resolveConst(name, ctx.filePath);
    if (!init) return undefined;
    const next = new Set(seen);
    next.add(`zod:${name}`);
    return tableZodTable(init.node, { ...ctx, filePath: init.file }, next, depth + 1);
  }
  if (unwrapped.type !== "CallExpression") return undefined;
  const call = unwrapped as CallExpression;
  if (identifierName(call.callee) !== "tableZod") return undefined;
  return resolveTableName(call.arguments[0], ctx);
}

function expandListIn(
  call: CallExpression,
  ctx: SchemaExpandContext,
  seen: Set<string>,
  depth: number,
): Record<string, unknown> {
  const properties = { ...LIST_IN_PROPERTIES };
  const extra = objectArg(call.arguments[1]);
  if (extra) {
    const added = objectFromZodProps(extra, ctx, seen, depth);
    const extraProps = (added.properties ?? {}) as Record<string, Record<string, unknown>>;
    Object.assign(properties, extraProps);
  }
  return { type: "object", properties };
}

function objectFromZodProps(
  obj: AstNode,
  ctx: SchemaExpandContext,
  seen: Set<string>,
  depth: number,
): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const prop of objectProperties(obj)) {
    const key = propKey(prop);
    const value = (prop as AstNode & { value?: AstNode }).value;
    if (!key || !value) continue;
    const schema = expand(value, ctx, seen, depth + 1);
    if (!schema) continue;
    properties[key] = schema;
    if (!isOptionalExpr(value)) required.push(key);
  }
  return objectSchema(properties, required);
}

function isOptionalExpr(node: AstNode): boolean {
  let cur: AstNode | undefined = unwrapTsExpr(node);
  while (cur && cur.type === "CallExpression") {
    const call = cur as CallExpression;
    const callee = unwrapTsExpr(call.callee);
    if (callee.type === "MemberExpression") {
      const member = callee as AstNode & { object: AstNode; property: AstNode };
      const method = identifierName(member.property);
      if (method === "optional" || method === "nullish") return true;
      cur = member.object;
      continue;
    }
    break;
  }
  return false;
}

function resolveTableName(node: AstNode | undefined, ctx: SchemaExpandContext): string | undefined {
  const id = identifierName(node ? unwrapTsExpr(node) : undefined);
  if (!id) return undefined;
  const binding = ctx.bindings.get(id);
  if (binding?.kind === "table") return binding.ref;
  if (ctx.tableColumns(id)) return id;
  return undefined;
}

function columnToProperty(col: DeclaredColumn): Record<string, unknown> {
  const type = col.type === "integer" ? "integer" : "string";
  return {
    type,
    ...(col.description !== undefined ? { description: col.description } : {}),
    ...(col.pii ? { pii: true } : {}),
    ...(col.sensitive ? { sensitive: true } : {}),
    ...(col.primaryKey ? { primaryKey: true } : {}),
    ...(col.unique ? { unique: true } : {}),
    ...(col.references ? { references: col.references } : {}),
  };
}

function isGeneratedPrimaryKey(col: DeclaredColumn): boolean {
  // OKE `field.text().primaryKey().defaultFn(id)` — same as drizzle
  // `generatedAlwaysAsIdentity()`: omitted from insert / update.
  return col.primaryKey === true;
}

function columnHasDefault(col: DeclaredColumn): boolean {
  return col.default !== undefined;
}

function pickOmit(
  schema: Record<string, unknown>,
  keysNode: AstNode | undefined,
  mode: "pick" | "omit",
): Record<string, unknown> {
  const keys = trueKeys(keysNode);
  if (!keys) return schema;
  const properties = {
    ...((schema.properties as Record<string, Record<string, unknown>>) ?? {}),
  };
  const next: Record<string, Record<string, unknown>> = {};
  for (const [name, prop] of Object.entries(properties)) {
    const keep = mode === "pick" ? keys.has(name) : !keys.has(name);
    if (keep) next[name] = prop;
  }
  const required = Array.isArray(schema.required)
    ? (schema.required as string[]).filter((name) => name in next)
    : [];
  return objectSchema(next, required);
}

function mergeObjects(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const leftProps = (left?.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
  const rightProps =
    (right?.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
  const properties = { ...leftProps, ...rightProps };
  const required = [
    ...new Set([
      ...(Array.isArray(left?.required) ? (left.required as string[]) : []),
      ...(Array.isArray(right?.required) ? (right.required as string[]) : []),
    ]),
  ].filter((name) => name in properties);
  return objectSchema(properties, required);
}

function objectSchema(
  properties: Record<string, Record<string, unknown>>,
  required: readonly string[],
): Record<string, unknown> {
  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required: [...required] } : {}),
  };
}

/**
 * Default `listIn({ mode: "offset" })` query shape (pagination on HTTP meta).
 */
export function defaultListInSchema(): Record<string, unknown> {
  return { type: "object", properties: { ...LIST_IN_PROPERTIES } };
}

function leafFromZodType(method: string): Record<string, unknown> | undefined {
  if (method === "string") return { type: "string" };
  if (method === "number") return { type: "number" };
  if (method === "int") return { type: "integer" };
  if (method === "bigint") return { type: "integer" };
  if (method === "boolean") return { type: "boolean" };
  if (method === "date") return { type: "string", format: "date-time" };
  if (method === "unknown" || method === "any") return {};
  if (method === "void" || method === "undefined" || method === "null") return { type: "null" };
  if (method === "coerce") return undefined;
  return undefined;
}

function trueKeys(node: AstNode | undefined): Set<string> | undefined {
  const obj = objectArg(node);
  if (!obj) return undefined;
  const keys = new Set<string>();
  for (const prop of objectProperties(obj)) {
    const key = propKey(prop);
    const value = (prop as AstNode & { value?: AstNode }).value;
    if (!key) continue;
    if (!value || (value.type === "Literal" && (value as Literal).value === true)) {
      keys.add(key);
    }
  }
  return keys;
}

function stringArrayArg(node: AstNode | undefined): string[] | undefined {
  if (!node || node.type !== "ArrayExpression") return undefined;
  const els = (node as AstNode & { elements?: readonly (AstNode | null)[] }).elements ?? [];
  const out: string[] = [];
  for (const el of els) {
    const s = stringArg(el ?? undefined);
    if (s) out.push(s);
  }
  return out.length > 0 ? out : undefined;
}

function numberArg(node: AstNode | undefined): number | undefined {
  if (!node || node.type !== "Literal") return undefined;
  const v = (node as Literal).value;
  return typeof v === "number" ? v : undefined;
}

function literalValue(node: AstNode | undefined): string | number | boolean | null | undefined {
  if (!node || node.type !== "Literal") return undefined;
  const v = (node as Literal).value;
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return v;
  }
  return undefined;
}

function literalJsonType(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return "boolean";
}

function unwrapTsExpr(node: AstNode): AstNode {
  if (node.type === "TSAsExpression" || node.type === "TSTypeAssertion") {
    const expr = (node as AstNode & { expression?: AstNode }).expression;
    if (expr) return unwrapTsExpr(expr);
  }
  return node;
}

function objectArg(node: AstNode | undefined): AstNode | undefined {
  if (!node) return undefined;
  const unwrapped = unwrapTsExpr(node);
  return unwrapped.type === "ObjectExpression" ? unwrapped : undefined;
}

function objectProperties(obj: AstNode): AstNode[] {
  return ((obj as AstNode & { properties?: AstNode[] }).properties ?? []).filter(
    (p) => p.type === "Property" || p.type === "ObjectProperty",
  );
}

function propKey(prop: AstNode): string | undefined {
  const key = (prop as AstNode & { key?: AstNode }).key;
  if (!key) return undefined;
  if (key.type === "Identifier") return (key as Identifier).name;
  if (key.type === "Literal" && typeof (key as Literal).value === "string") {
    return (key as Literal).value as string;
  }
  return undefined;
}
