/**
 * Store-backed seed invoke — Call API returns the row that moved, not `{ ok }`.
 *
 * Seeded Console shares the same {@link StoreRuntime} as Store browse, so
 * list / get / create / update / delete (and light actions) read and write
 * real keel rows.
 */

import type { Flow, Manifest, ResourceRef } from "../../manifest/types.ts";
import { fail } from "../../kernel/errors.ts";
import type { KvStoreFxHandle, SqlStoreHandle, StoreRuntime } from "../../elements/store.ts";
import { deleteStore, editStore } from "../server/store.ts";

/** Page size for list / search invoke. */
export const SEED_INVOKE_LIST_LIMIT = 25;

/** Classified seed HTTP verb. */
export type SeedInvokeOp = "list" | "get" | "create" | "update" | "delete" | "action";

/** Input to {@link executeSeedInvoke}. */
export interface ExecuteSeedInvokeInput {
  readonly runtime: StoreRuntime;
  readonly manifest: Manifest;
  readonly flowId: string;
  readonly path: string;
  readonly decl: Flow;
  readonly input: Readonly<Record<string, unknown>>;
  readonly userId: string;
}

/**
 * Classify a flow id into a store verb (`issues.list` → `list`).
 *
 * @param flowId - Manifest flow id
 */
export function seedInvokeOp(flowId: string): SeedInvokeOp {
  const verb = flowId.split(".").pop() ?? "";
  if (verb === "list" || verb === "search" || verb === "suggest") return "list";
  if (verb === "get") return "get";
  if (verb === "create" || verb === "upload" || verb === "upsert") return "create";
  if (verb === "update") return "update";
  if (verb === "delete") return "delete";
  return "action";
}

/**
 * True when a path param is missing or still the `:token` placeholder.
 *
 * @param id - Candidate id
 */
export function isPlaceholderId(id: string | undefined): boolean {
  return id === undefined || id.length === 0 || id.startsWith(":");
}

/**
 * First SQL table named in writes, then reads (`sql:issues` → `issues`).
 *
 * @param decl - Manifest flow
 */
export function primarySqlTable(decl: Flow): string | null {
  const refs = [...(decl.effects?.writes ?? []), ...(decl.effects?.reads ?? [])];
  for (const ref of refs) {
    if (!ref.startsWith("sql:")) continue;
    const name = ref.slice(4);
    if (name.length === 0 || name === "db") continue;
    return name;
  }
  return null;
}

/**
 * First `files:` write ref, if any.
 *
 * @param decl - Manifest flow
 */
export function filesWriteRef(decl: Flow): ResourceRef | null {
  const found = (decl.effects?.writes ?? []).find((ref) => ref.startsWith("files:"));
  return found ? (found as ResourceRef) : null;
}

/**
 * Execute a seeded HTTP flow against Console Store.
 *
 * @param options - Runtime, Manifest flow, assembled input
 */
export async function executeSeedInvoke(
  options: ExecuteSeedInvokeInput,
): Promise<Record<string, unknown> | ReturnType<typeof fail>> {
  const { runtime, manifest, flowId, path, decl, input, userId } = options;
  const op = seedInvokeOp(flowId);
  const table = primarySqlTable(decl);
  const filesRef = filesWriteRef(decl);
  const rawId = stringField(input, "id");
  const id = isPlaceholderId(rawId) ? undefined : rawId;

  if (op === "list") {
    if (!table) {
      return { ok: true, flow: flowId, userId, items: [], count: 0, total: 0 };
    }
    return listRows(runtime, path, table, input);
  }

  if (op === "get") {
    if (!table || id === undefined) {
      return fail("NotFound", { id: rawId ?? "", flow: flowId });
    }
    const row = await getRow(runtime, table, id);
    if (!row) return fail("NotFound", { id, flow: flowId });
    return row;
  }

  if (op === "create") {
    if (!table) {
      return { ok: true, flow: flowId, userId, ...plainInput(input) };
    }
    const created = await createRow(runtime, manifest, table, input, userId);
    return created;
  }

  if (op === "update") {
    if (!table || id === undefined) {
      return fail("NotFound", { id: rawId ?? "", flow: flowId });
    }
    const existing = await getRow(runtime, table, id);
    if (!existing) return fail("NotFound", { id, flow: flowId });
    return updateRow(runtime, manifest, table, id, input);
  }

  if (op === "delete") {
    if (id === undefined) {
      return fail("NotFound", { id: rawId ?? "", flow: flowId });
    }
    return deleteRow(runtime, manifest, table, filesRef, id, flowId);
  }

  if (decl.effects?.calls?.includes("issues.create") && stringField(input, "title")) {
    const issue = await createRow(runtime, manifest, "issues", input, userId);
    return { ok: true, flow: flowId, userId, called: ["issues.create"], issue };
  }

  if (!table || id === undefined) {
    return { ok: true, flow: flowId, userId, ...plainInput(input) };
  }
  const existing = await getRow(runtime, table, id);
  if (!existing) return fail("NotFound", { id, flow: flowId });
  return applyAction(runtime, manifest, flowId, table, existing, input);
}

async function listRows(
  runtime: StoreRuntime,
  path: string,
  table: string,
  input: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const limit = clampLimit(input.limit);
  const offset = resolveListOffset(input);
  const parent = parentFilter(path, input);
  const q = stringField(input, "q");
  const where: string[] = [];
  const params: unknown[] = [];

  if (parent) {
    if (table === "file_objects" && parent.column === "issue_id") {
      const issue = await getRow(runtime, "issues", parent.value);
      const ident = typeof issue?.identifier === "string" ? issue.identifier : parent.value;
      where.push(`"object_key" LIKE ?`);
      params.push(`attachments/${ident}/%`);
    } else {
      where.push(`"${parent.column}" = ?`);
      params.push(parent.value);
    }
  }
  const teamKey = stringField(input, "teamKey", "team_key");
  if (teamKey && TEAM_FILTER_TABLES.has(table)) {
    const team = await getRowBy(runtime, "teams", "key", teamKey);
    if (team && typeof team.id === "string") {
      where.push(`"team_id" = ?`);
      params.push(team.id);
    }
  }
  if (q) {
    const columns = searchColumns(table);
    where.push(`(${columns.map((col) => `"${col}" LIKE ?`).join(" OR ")})`);
    const like = `%${q}%`;
    for (let i = 0; i < columns.length; i++) params.push(like);
  }

  const clause = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
  const orderBy = sanitizeOrderBy(input.orderBy);
  const order = sanitizeOrder(input.order);
  const sql = await openSql(runtime, { reads: true });
  const totalRows = await sql.raw(`SELECT COUNT(*) AS "count" FROM "${table}"${clause}`, params);
  const items = await sql.raw(
    `SELECT * FROM "${table}"${clause} ORDER BY "${orderBy}" ${order} LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  const total = Number(totalRows[0]?.count ?? totalRows[0]?.COUNT ?? items.length);
  const nextOffset = offset + items.length;
  return {
    items,
    count: items.length,
    total,
    limit,
    offset,
    ...(nextOffset < total ? { nextCursor: encodeListCursor(nextOffset) } : {}),
  };
}

async function createRow(
  runtime: StoreRuntime,
  manifest: Manifest,
  table: string,
  input: Readonly<Record<string, unknown>>,
  userId: string,
): Promise<Record<string, unknown>> {
  const columns = await columnsForInsert(runtime, table, input, userId);
  await editStore(
    runtime,
    manifest,
    { ref: "sql:db", child: table, patch: columns },
    { production: false },
  );
  const id = String(columns.id);
  return (await getRow(runtime, table, id)) ?? columns;
}

async function updateRow(
  runtime: StoreRuntime,
  manifest: Manifest,
  table: string,
  id: string,
  input: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const patch = omitId(await mapColumns(runtime, table, input));
  if (Object.keys(patch).length > 0) {
    await editStore(
      runtime,
      manifest,
      { ref: "sql:db", child: table, id, patch },
      { production: false },
    );
  }
  return (await getRow(runtime, table, id)) ?? { id, ...patch };
}

async function deleteRow(
  runtime: StoreRuntime,
  manifest: Manifest,
  table: string | null,
  filesRef: ResourceRef | null,
  id: string,
  flowId: string,
): Promise<Record<string, unknown> | ReturnType<typeof fail>> {
  let row: Record<string, unknown> | null = null;
  if (table) {
    row = await getRow(runtime, table, id);
    if (!row && table === "file_objects") {
      row = await getRowBy(runtime, table, "object_key", id);
    }
  }
  if (!row && !filesRef) {
    return fail("NotFound", { id, flow: flowId });
  }

  const objectKey =
    (typeof row?.object_key === "string" && row.object_key) || (filesRef ? id : undefined);

  if (filesRef && objectKey) {
    await deleteStore(runtime, { ref: filesRef, keys: [objectKey] }, manifest);
  }
  if (table && row) {
    const rowId = typeof row.id === "string" ? row.id : id;
    await deleteStore(runtime, { ref: "sql:db", child: table, ids: [rowId] }, manifest);
  }

  return {
    ok: true,
    id,
    deleted: row ?? { id },
  };
}

async function applyAction(
  runtime: StoreRuntime,
  manifest: Manifest,
  flowId: string,
  table: string,
  existing: Record<string, unknown>,
  input: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const verb = flowId.split(".").pop() ?? "action";
  const id = typeof existing.id === "string" ? existing.id : "";
  const now = new Date().toISOString();

  if (verb === "duplicate") {
    const copy: Record<string, unknown> = { ...existing, id: `${id}_copy_${tinyId()}` };
    if (typeof copy.identifier === "string") {
      copy.identifier = `${copy.identifier}-copy`;
    }
    await editStore(
      runtime,
      manifest,
      { ref: "sql:db", child: table, patch: copy },
      { production: false },
    );
    const created = (await getRow(runtime, table, String(copy.id))) ?? copy;
    return { ok: true, id: created.id, ...created };
  }

  if (verb === "snooze") {
    const until = stringField(input, "until") ?? now;
    const ident = typeof existing.identifier === "string" ? existing.identifier : id;
    const kv = (await runtime.openRef("kv:cache", {
      effects: { writes: ["kv:cache"] },
    })) as KvStoreFxHandle;
    await kv.set(`triage-snooze:${ident}`, { until, reason: input.reason ?? null });
    return { ok: true, id, until, ...existing };
  }

  const patch = actionPatch(verb, input, now);
  if (Object.keys(patch).length > 0) {
    await editStore(
      runtime,
      manifest,
      { ref: "sql:db", child: table, id, patch },
      { production: false },
    );
  }
  const next = (await getRow(runtime, table, id)) ?? { ...existing, ...patch };
  return {
    ok: true,
    id,
    ...next,
    ...(verb === "subscribe" ? { subscribed: true } : {}),
    ...(verb === "unsubscribe" ? { subscribed: false } : {}),
    ...(verb === "resolve" ? { resolved: true } : {}),
    ...(verb === "unresolve" ? { resolved: false } : {}),
  };
}

function actionPatch(
  verb: string,
  input: Readonly<Record<string, unknown>>,
  now: string,
): Record<string, unknown> {
  if (verb === "archive") return { archived_at: now };
  if (verb === "unarchive") return { archived_at: null };
  if (verb === "assign") {
    const email = stringField(input, "assigneeEmail", "assignee_email");
    return email ? { assignee_email: email } : {};
  }
  if (verb === "move" || verb === "transfer") {
    const out: Record<string, unknown> = {};
    const teamKey = stringField(input, "teamKey", "team_key");
    if (teamKey) out.team_key = teamKey;
    const projectId = stringField(input, "projectId", "project_id");
    if (projectId) out.project_id = projectId;
    const cycleId = stringField(input, "cycleId", "cycle_id");
    if (cycleId) out.cycle_id = cycleId;
    return out;
  }
  return omitId(snakeRecord(input));
}

async function columnsForInsert(
  runtime: StoreRuntime,
  table: string,
  input: Readonly<Record<string, unknown>>,
  userId: string,
): Promise<Record<string, unknown>> {
  const mapped = await mapColumns(runtime, table, input);
  const id =
    (typeof mapped.id === "string" && mapped.id.length > 0 ? mapped.id : undefined) ??
    `${table.replace(/s$/, "")}_${tinyId()}`;
  mapped.id = id;
  if (table === "issues") {
    const teamKey =
      stringField(input, "teamKey", "team_key") ??
      (typeof mapped.team_id === "string" ? mapped.team_id : "ENG");
    if (!mapped.identifier) {
      mapped.identifier = `${teamKey}-${tinyId()}`;
    }
    if (!mapped.title) mapped.title = stringField(input, "title") ?? "Untitled";
    if (!mapped.creator_email) mapped.creator_email = userId;
  }
  return mapped;
}

async function mapColumns(
  runtime: StoreRuntime,
  table: string,
  input: Readonly<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const mapped = snakeRecord(input);
  const teamKey = stringField(input, "teamKey", "team_key");
  if (teamKey && (table === "issues" || table === "teams")) {
    const team = await getRowBy(runtime, "teams", "key", teamKey);
    if (team && typeof team.id === "string") {
      mapped.team_id = team.id;
      delete mapped.team_key;
    }
  }
  return mapped;
}

async function getRow(
  runtime: StoreRuntime,
  table: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const sql = await openSql(runtime, { reads: true });
  const rows = await sql.raw(`SELECT * FROM "${table}" WHERE "id" = ? LIMIT 1`, [id]);
  return rows[0] ?? null;
}

async function getRowBy(
  runtime: StoreRuntime,
  table: string,
  column: string,
  value: string,
): Promise<Record<string, unknown> | null> {
  const sql = await openSql(runtime, { reads: true });
  const rows = await sql.raw(`SELECT * FROM "${table}" WHERE "${column}" = ? LIMIT 1`, [value]);
  return rows[0] ?? null;
}

async function openSql(
  runtime: StoreRuntime,
  mode: { readonly reads?: boolean; readonly writes?: boolean },
): Promise<SqlStoreHandle> {
  const effects = {
    ...(mode.reads ? { reads: ["sql:db" as const] } : {}),
    ...(mode.writes ? { writes: ["sql:db" as const] } : {}),
  };
  return (await runtime.openRef("sql:db", {
    effects,
    revealPii: true,
  })) as SqlStoreHandle;
}

/**
 * Nested collection filter (`/issues/:id/comments` → `issue_id`).
 *
 * @param path - HTTP path pattern
 * @param input - Assembled params + body
 */
export function parentFilter(
  path: string,
  input: Readonly<Record<string, unknown>>,
): { readonly column: string; readonly value: string } | null {
  const parts = path.split("/").filter(Boolean);
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i];
    const next = parts[i + 1];
    // Item routes (`/attachments/:id`) — the param is the row, not a parent.
    if (i + 1 >= parts.length - 1) continue;
    if (!seg || !next?.startsWith(":") || seg.startsWith(":")) continue;
    const param = next.slice(1);
    const value = stringField(input, param);
    if (!value || isPlaceholderId(value)) continue;
    const singular = seg.endsWith("s") ? seg.slice(0, -1) : seg;
    return { column: `${singular}_id`, value };
  }
  return null;
}

function stringField(
  input: Readonly<Record<string, unknown>>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function snakeRecord(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[snakeKey(key)] = value;
  }
  return out;
}

function snakeKey(key: string): string {
  return key.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

function omitId(row: Record<string, unknown>): Record<string, unknown> {
  const { id: _id, ...rest } = row;
  return rest;
}

function plainInput(input: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const TEAM_FILTER_TABLES = new Set(["issues", "cycles", "labels", "members"]);

const SEARCH_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  issues: ["title", "identifier", "description", "id"],
  comments: ["body", "id", "author_email"],
  projects: ["name", "id"],
  documents: ["title", "body", "id"],
  file_objects: ["object_key", "original_name", "id"],
  teams: ["key", "name", "id"],
  labels: ["name", "group_name", "id"],
  cycles: ["name", "id"],
  members: ["name", "email", "id"],
};

/**
 * Encode a list page offset as an opaque cursor.
 *
 * @param offset - Absolute row offset
 */
export function encodeListCursor(offset: number): string {
  return Buffer.from(String(offset), "utf8").toString("base64url");
}

/**
 * Decode a list cursor to an offset, or undefined when invalid.
 *
 * @param cursor - Opaque page token
 */
export function decodeListCursor(cursor: string): number | undefined {
  try {
    const n = Number(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Number.isFinite(n) || n < 0) return undefined;
    return Math.floor(n);
  } catch {
    return undefined;
  }
}

function searchColumns(table: string): readonly string[] {
  return SEARCH_COLUMNS[table] ?? ["id"];
}

function sanitizeOrderBy(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (/^[a-z][a-z0-9_]*$/i.test(raw)) return raw;
  return "id";
}

function sanitizeOrder(value: unknown): "ASC" | "DESC" {
  return value === "desc" || value === "DESC" ? "DESC" : "ASC";
}

function clampLimit(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(100, Math.max(1, Math.floor(value)));
  }
  return SEED_INVOKE_LIST_LIMIT;
}

function clampOffset(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  return 0;
}

function resolveListOffset(input: Readonly<Record<string, unknown>>): number {
  const cursor = stringField(input, "cursor");
  if (cursor) {
    const fromCursor = decodeListCursor(cursor);
    if (fromCursor !== undefined) return fromCursor;
  }
  return clampOffset(input.offset);
}

function tinyId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}
