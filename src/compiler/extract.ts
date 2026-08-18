/**
 * Manifest extraction — oxc parse → bindings → flows → effects → Manifest.
 *
 * Never uses the TypeScript compiler API (unified-theory §11). `tsc` remains
 * for type-checking only; this module is the build-time close-the-loop path
 * from source to `manifest.oke.json`.
 */

import { parseSync } from "oxc-parser";

import type {
  Ai,
  AiAgent,
  AiModel,
  AiPrompt,
  Channel,
  ChannelMedium,
  Clock,
  DeclaredColumn,
  Effects,
  Flow,
  Gate,
  Journey,
  Manifest,
  RateStrategy,
  ResourceRef,
  SecretContract,
  Signal,
  SignalDelivery,
  Slo,
  Store,
  Trigger,
} from "../manifest/types.ts";
import { sqlTableRef } from "../manifest/sql-resource.ts";
import {
  identifierName,
  inferEffects,
  stringArg,
  walk,
  type AstNode,
  type CallExpression,
  type Identifier,
  type InferBinding,
  type Literal,
} from "./effects-infer.ts";

/** One source file for extraction. */
export interface SourceFile {
  /** Path relative to the app root (used in `source` and for imports). */
  readonly path: string;
  /** File contents. */
  readonly source: string;
}

/** Options for {@link extractManifest}. */
export interface ExtractManifestOptions {
  /** Application root (for reading files when `files` is omitted). */
  readonly rootDir?: string;
  /** Explicit sources (tests / synthetic apps). */
  readonly files?: readonly SourceFile[];
  /** Glob under `rootDir` (default: all TypeScript files recursively). */
  readonly glob?: string;
  /** Override app name when `oke({ name })` is absent. */
  readonly app?: string;
}

/** Internal project scope accumulated across files. */
interface ProjectScope {
  app: string;
  bindings: Map<string, InferBinding>;
  signals: Record<string, Signal>;
  stores: Record<string, Store>;
  /** Binding or table name → declared columns from `store.schema.table`. */
  schemaTables: Map<
    string,
    { readonly name: string; readonly columns: Record<string, DeclaredColumn> }
  >;
  clocks: Record<string, Clock>;
  gates: Record<string, Gate>;
  /** Local binding name → gate manifest id (policy name or rate expression). */
  gateIds: Map<string, string>;
  /** Local binding name → member binding names (`gate.all` or a const array). */
  gateAllIds: Map<string, string[]>;
  /** Bindings declared with `gate.all(...)` (catalogued; arrays are not). */
  gateAllDecls: Set<string>;
  vault: Record<string, SecretContract>;
  channels: Record<string, Channel>;
  ai: Ai;
  journeys: Record<string, Journey>;
  drivers: Record<string, string[]>;
  tenancy?: Manifest["tenancy"];
  i18n?: Manifest["i18n"];
  topology?: Manifest["topology"];
  images?: Record<string, string>;
  flows: Record<string, Flow>;
  /** Export name → flow id (for agent tools). */
  flowExports: Map<string, string>;
  /** Local binding name → store.resource declaration (for on(http.resource)). */
  resources: Map<string, { storeName: string; storeRef: string; breaking?: boolean }>;
  /** Local binding name → medium, for `const x = channel.email(…)` binders. */
  channelMediumBindings: Map<string, ChannelMedium>;
}

/**
 * Extract a Manifest from TypeScript sources via oxc.
 *
 * @param options - Root directory and/or explicit files
 */
export async function extractManifest(options: ExtractManifestOptions = {}): Promise<Manifest> {
  const files = options.files
    ? [...options.files]
    : await readSources(options.rootDir ?? ".", options.glob ?? "**/*.{ts,tsx}");

  const scope: ProjectScope = {
    app: options.app ?? "app",
    bindings: new Map(),
    signals: {},
    stores: {},
    schemaTables: new Map(),
    clocks: {},
    gates: {},
    gateIds: new Map(),
    gateAllIds: new Map(),
    gateAllDecls: new Set(),
    vault: {},
    channels: {},
    ai: {},
    journeys: {},
    drivers: {},
    flows: {},
    flowExports: new Map(),
    resources: new Map(),
    channelMediumBindings: new Map(),
  };

  const parsed = files.map((file) => {
    const result = parseSync(file.path, file.source, {
      sourceType: "module",
      lang: file.path.endsWith("x") ? "tsx" : "ts",
    });
    return { file, program: result.program as unknown as AstNode };
  });

  // Pass 1 — declarations (elements, config, named bindings).
  for (const { program } of parsed) {
    collectDeclarations(program, scope);
  }

  // Pass 2 — flows / on() bindings.
  for (const { file, program } of parsed) {
    collectFlows(file, program, scope);
  }

  // Pass 3 — resolve deferred refs (agent tools, journey paths).
  finalizeRefs(scope);

  // Stable ordering for golden files.
  const flows = sortRecord(scope.flows);
  const signals = sortRecord(scope.signals);
  const stores = sortRecord(scope.stores);
  const clocks = sortRecord(scope.clocks);
  const gates = sortRecord(scope.gates);
  const vault = sortRecord(scope.vault);
  const channels = sortRecord(scope.channels);
  const journeys = sortRecord(scope.journeys);
  const drivers = sortRecord(scope.drivers);

  const manifest: Manifest = {
    oke: "1.0",
    app: scope.app,
  };

  if (Object.keys(flows).length > 0) manifest.flows = flows;
  if (Object.keys(signals).length > 0) manifest.signals = signals;
  if (Object.keys(stores).length > 0) manifest.stores = stores;
  if (Object.keys(clocks).length > 0) manifest.clocks = clocks;
  if (Object.keys(gates).length > 0) manifest.gates = gates;
  if (Object.keys(vault).length > 0) manifest.vault = vault;
  if (Object.keys(channels).length > 0) manifest.channels = channels;
  if (scope.ai.models || scope.ai.prompts || scope.ai.agents) {
    manifest.ai = {
      ...(scope.ai.models ? { models: sortRecord(scope.ai.models) } : {}),
      ...(scope.ai.prompts ? { prompts: sortRecord(scope.ai.prompts) } : {}),
      ...(scope.ai.agents ? { agents: sortRecord(scope.ai.agents) } : {}),
    };
  }
  if (Object.keys(journeys).length > 0) manifest.journeys = journeys;
  if (Object.keys(drivers).length > 0) manifest.drivers = drivers;
  if (scope.tenancy) manifest.tenancy = scope.tenancy;
  if (scope.i18n) manifest.i18n = scope.i18n;
  if (scope.topology) manifest.topology = scope.topology;
  if (scope.images) manifest.images = scope.images;

  return manifest;
}

/**
 * Extract from an in-memory map of path → source (convenience for tests).
 *
 * @param sources - Path → source text
 * @param app - Optional app name override
 */
export async function extractFromSources(
  sources: Readonly<Record<string, string>>,
  app?: string,
): Promise<Manifest> {
  const files = Object.entries(sources).map(([path, source]) => ({
    path,
    source,
  }));
  return extractManifest({ files, app });
}

async function readSources(rootDir: string, pattern: string): Promise<SourceFile[]> {
  // Bun.Glob (global) — bare `import … from "bun"` is rejected by JSR.
  const glob = new Bun.Glob(pattern);
  const files: SourceFile[] = [];
  for await (const path of glob.scan({
    cwd: rootDir,
    onlyFiles: true,
  })) {
    if (path.includes("node_modules/") || path.endsWith(".test.ts")) continue;
    const abs = `${rootDir.replace(/\/$/, "")}/${path}`;
    files.push({ path, source: await Bun.file(abs).text() });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function collectDeclarations(program: AstNode, scope: ProjectScope): void {
  walk(program, (node) => {
    if (node.type === "CallExpression") {
      visitDeclarationCall(node as CallExpression, program, scope);
    }
    if (node.type === "VariableDeclarator") {
      visitDeclarator(node as AstNode, scope);
    }
  });

  // oke({ name })
  walk(program, (node) => {
    if (node.type !== "CallExpression") return;
    const call = node as CallExpression;
    if (identifierName(call.callee) !== "oke") return;
    const opts = objectArg(call.arguments[0]);
    const name = stringProp(opts, "name");
    if (name) scope.app = name;
  });
}

function visitDeclarator(decl: AstNode, scope: ProjectScope): void {
  const id = (decl as AstNode & { id?: AstNode }).id;
  const init = (decl as AstNode & { init?: AstNode }).init;
  if (!id || !init) return;
  const name = identifierName(id);
  if (!name) return;

  // export const x = on(...) / flow(...) — flow export alias
  if (init.type === "CallExpression") {
    const call = init as CallExpression;
    const callee = identifierName(call.callee);
    if (callee === "on" || callee === "flow") {
      // Resolved in pass 2 once the flow name is known; stash export hint.
      scope.flowExports.set(name, name);
    }
  }

  // Re-exports / aliases: const canBook = bookingCreateGate
  if (init.type === "Identifier") {
    const target = (init as Identifier).name;
    const binding = scope.bindings.get(target);
    if (binding) scope.bindings.set(name, binding);
    const gateId = scope.gateIds.get(target);
    if (gateId) scope.gateIds.set(name, gateId);
    const allIds = scope.gateAllIds.get(target);
    if (allIds) scope.gateAllIds.set(name, allIds);
    if (scope.gateAllDecls.has(target)) scope.gateAllDecls.add(name);
  }

  const arrayInit = unwrapTsExpr(init);
  if (arrayInit.type === "ArrayExpression") {
    const members = arrayMemberNames(arrayInit);
    if (members.length > 0) scope.gateAllIds.set(name, members);
  }
}

function finalizeRefs(scope: ProjectScope): void {
  for (const binding of scope.gateAllDecls) {
    const members = scope.gateAllIds.get(binding);
    if (!members) continue;
    scope.gates[binding] = {
      kind: "all",
      members: expandGateNames(members, scope, new Set()),
    };
  }
  if (scope.ai.agents) {
    for (const agent of Object.values(scope.ai.agents)) {
      if (!agent.tools) continue;
      agent.tools = agent.tools.map(
        (id) => scope.flowExports.get(id) ?? scope.bindings.get(id)?.ref ?? id,
      );
    }
  }
  for (const journey of Object.values(scope.journeys)) {
    if (!journey.flows) continue;
    journey.flows = journey.flows.map(
      (id) => scope.flowExports.get(id) ?? scope.bindings.get(id)?.ref ?? id,
    );
  }

  // Merge declared columns into store.tables (handles declare-after-sql order).
  for (const store of Object.values(scope.stores)) {
    if (!store.tables) continue;
    for (const [name, table] of Object.entries(store.tables)) {
      const declared = [...scope.schemaTables.values()].find((t) => t.name === name);
      if (!declared) continue;
      const existing = table.columns ?? {};
      if (Object.keys(existing).length === 0) {
        store.tables[name] = { ...table, columns: declared.columns };
      }
    }
  }

  // Orphan abstract tables (declared but not wired via store.sql schema):
  // attach under the first sql store, or create a synthetic "app" sql store.
  const attachedNames = new Set<string>();
  for (const store of Object.values(scope.stores)) {
    if (!store.tables) continue;
    for (const name of Object.keys(store.tables)) attachedNames.add(name);
  }
  const orphanByName = new Map<string, { name: string; columns: Record<string, DeclaredColumn> }>();
  for (const t of scope.schemaTables.values()) {
    if (!attachedNames.has(t.name)) orphanByName.set(t.name, t);
  }
  if (orphanByName.size > 0) {
    let target = Object.entries(scope.stores).find(([, s]) => s.facet === "sql")?.[1];
    if (!target) {
      scope.stores.app = scope.stores.app ?? { facet: "sql" };
      target = scope.stores.app!;
    }
    target.tables = target.tables ?? {};
    for (const t of orphanByName.values()) {
      if (target.tables[t.name]) continue;
      target.tables[t.name] = { columns: t.columns };
    }
  }
}

function collectSchemaTable(call: CallExpression, program: AstNode, scope: ProjectScope): void {
  const tableName = stringArg(call.arguments[0]);
  if (!tableName) return;
  const colsNode = objectArg(call.arguments[1]);
  const columns = colsNode ? parseDeclaredColumns(colsNode) : {};
  const entry = { name: tableName, columns };
  scope.schemaTables.set(tableName, entry);
  const bindingName = enclosingConstName(call, program);
  if (bindingName) {
    scope.schemaTables.set(bindingName, entry);
    // Declared table name, not the JS binding — resolved by
    // tableFromStoreChain so `const notesTable = store.schema.table("notes",
    // …)` still infers "sql:notes", matching what the kernel reads off the
    // live table object (see ../manifest/sql-resource.ts).
    scope.bindings.set(bindingName, { kind: "table", ref: tableName });
  }
}

function attachSchemaOption(
  optsNode: AstNode | undefined,
  store: Store,
  scope: ProjectScope,
): void {
  const opts = objectArg(optsNode);
  if (!opts) return;
  const schemaNode = objectProp(opts, "schema");
  if (!schemaNode) return;

  // schema: { notes } or schema: { notes: store.schema.table(...) }
  if (schemaNode.type === "ObjectExpression") {
    store.tables = store.tables ?? {};
    for (const prop of objectProperties(schemaNode)) {
      const key = propKey(prop);
      const value = (prop as AstNode & { value?: AstNode }).value;
      if (!key || !value) continue;

      if (value.type === "Identifier") {
        const id = (value as Identifier).name;
        const declared = scope.schemaTables.get(id) ?? scope.schemaTables.get(key);
        if (declared) {
          store.tables[declared.name] = { columns: declared.columns };
        } else {
          store.tables[key] = store.tables[key] ?? {};
        }
        continue;
      }

      if (value.type === "CallExpression") {
        const inline = parseInlineSchemaTable(value as CallExpression);
        if (inline) {
          store.tables[inline.name] = { columns: inline.columns };
          scope.schemaTables.set(inline.name, inline);
        }
      }
    }
    return;
  }

  // schema: notesModule (identifier — unknown shape; skip columns)
  if (schemaNode.type === "Identifier") {
    // Namespace import — table names unknown at extract time.
  }
}

function parseInlineSchemaTable(
  call: CallExpression,
): { name: string; columns: Record<string, DeclaredColumn> } | undefined {
  const callee = call.callee;
  if (callee.type !== "MemberExpression") return undefined;
  const member = callee as AstNode & { object: AstNode; property: AstNode };
  if (identifierName(member.property) !== "table") return undefined;
  if (member.object.type !== "MemberExpression") return undefined;
  const inner = member.object as AstNode & { object: AstNode; property: AstNode };
  if (identifierName(inner.object) !== "store" || identifierName(inner.property) !== "schema") {
    return undefined;
  }
  const tableName = stringArg(call.arguments[0]);
  if (!tableName) return undefined;
  const colsNode = objectArg(call.arguments[1]);
  return {
    name: tableName,
    columns: colsNode ? parseDeclaredColumns(colsNode) : {},
  };
}

function parseDeclaredColumns(obj: AstNode): Record<string, DeclaredColumn> {
  const out: Record<string, DeclaredColumn> = {};
  for (const prop of objectProperties(obj)) {
    const key = propKey(prop);
    const value = (prop as AstNode & { value?: AstNode }).value;
    if (!key || !value) continue;
    const col = parseFieldChain(value, key);
    if (col) out[key] = col;
  }
  return out;
}

/**
 * Walk `field.text().notNull().pii()` (and similar) into a DeclaredColumn.
 *
 * @param node - AST node for the column value
 * @param key - JS key (for default sqlName)
 */
function parseFieldChain(node: AstNode, key: string): DeclaredColumn | undefined {
  const chain: string[] = [];
  let sqlType: "text" | "integer" | undefined;
  let sqlName: string | undefined;
  let description: string | undefined;
  let defaultValue: string | number | boolean | null | undefined;
  let hasDefault = false;
  let cur: AstNode | undefined = node;

  while (cur && cur.type === "CallExpression") {
    const call = cur as CallExpression;
    const callee = call.callee;
    if (callee.type === "MemberExpression") {
      const member = callee as AstNode & { object: AstNode; property: AstNode };
      const method = identifierName(member.property);
      if (method) {
        chain.push(method);
        if (method === "as") {
          sqlName = stringArg(call.arguments[0]) ?? sqlName;
        }
        if (method === "describe") {
          description = stringArg(call.arguments[0]) ?? description;
        }
        if (method === "default") {
          const lit = call.arguments[0];
          if (lit && lit.type === "Literal") {
            const v = (lit as Literal).value;
            if (
              v === null ||
              typeof v === "string" ||
              typeof v === "number" ||
              typeof v === "boolean"
            ) {
              defaultValue = v as string | number | boolean | null;
              hasDefault = true;
            }
          }
        }
      }
      cur = member.object;
      continue;
    }
    if (callee.type === "Identifier" && (callee as Identifier).name === "field") {
      // shouldn't happen — field.text() is MemberExpression
      break;
    }
    break;
  }

  // Remaining should be field.text / field.integer
  if (cur && cur.type === "MemberExpression") {
    const member = cur as AstNode & { object: AstNode; property: AstNode };
    if (identifierName(member.object) === "field") {
      const t = identifierName(member.property);
      if (t === "text" || t === "integer") sqlType = t;
    }
  }

  // Also: field.text() ends as CallExpression with callee MemberExpression field.text
  if (!sqlType && node.type === "CallExpression") {
    // Re-walk to find field.text() / field.integer() as a call
    let probe: AstNode | undefined = node;
    while (probe && probe.type === "CallExpression") {
      const call = probe as CallExpression;
      const callee = call.callee;
      if (callee.type === "MemberExpression") {
        const member = callee as AstNode & { object: AstNode; property: AstNode };
        if (
          identifierName(member.object) === "field" &&
          (identifierName(member.property) === "text" ||
            identifierName(member.property) === "integer")
        ) {
          sqlType = identifierName(member.property) as "text" | "integer";
          break;
        }
        probe = member.object;
        continue;
      }
      break;
    }
  }

  if (!sqlType) return undefined;

  const methods = new Set(chain);
  const col: DeclaredColumn = {
    type: sqlType,
    sqlName: sqlName ?? camelToSnakeKey(key),
    nullable: !(methods.has("notNull") || methods.has("primaryKey")),
    ...(methods.has("primaryKey") ? { primaryKey: true } : {}),
    ...(methods.has("unique") ? { unique: true } : {}),
    ...(hasDefault ? { default: defaultValue ?? null } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(methods.has("pii") ? { pii: true } : {}),
    ...(methods.has("sensitive") ? { sensitive: true } : {}),
  };
  if (methods.has("retain")) {
    // retain("7y") — find the call in the original chain by re-walk
    let probe: AstNode | undefined = node;
    while (probe && probe.type === "CallExpression") {
      const call = probe as CallExpression;
      const callee = call.callee;
      if (callee.type === "MemberExpression") {
        const member = callee as AstNode & { object: AstNode; property: AstNode };
        if (identifierName(member.property) === "retain") {
          const dur = stringArg(call.arguments[0]);
          if (dur) col.retain = dur;
          break;
        }
        probe = member.object;
        continue;
      }
      break;
    }
  }
  if (methods.has("references")) {
    // .references(() => links.code) — record table.column when statically readable
    let probe: AstNode | undefined = node;
    while (probe && probe.type === "CallExpression") {
      const call = probe as CallExpression;
      const callee = call.callee;
      if (callee.type === "MemberExpression") {
        const member = callee as AstNode & { object: AstNode; property: AstNode };
        if (identifierName(member.property) === "references") {
          const ref = parseReferencesArg(call.arguments[0]);
          if (ref) col.references = ref;
          break;
        }
        probe = member.object;
        continue;
      }
      break;
    }
  }
  return col;
}

/**
 * Parse `.references(() => table.column)` into a Manifest reference.
 *
 * @param arg - First argument to `.references(...)`
 */
function parseReferencesArg(
  arg: AstNode | undefined,
): { table?: string; column?: string } | undefined {
  if (!arg) return undefined;
  // ArrowFunctionExpression: () => links.code
  if (arg.type === "ArrowFunctionExpression" || arg.type === "FunctionExpression") {
    const fn = arg as AstNode & { body: AstNode };
    const body = fn.body;
    if (body.type === "MemberExpression") {
      const member = body as AstNode & { object: AstNode; property: AstNode };
      const table = identifierName(member.object);
      const column = identifierName(member.property);
      if (table || column) return { ...(table ? { table } : {}), ...(column ? { column } : {}) };
    }
  }
  return {};
}

function camelToSnakeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

const CHANNEL_MEDIUM_METHODS = new Set(["email", "sms", "whatsapp", "push"]);

function visitDeclarationCall(call: CallExpression, program: AstNode, scope: ProjectScope): void {
  const callee = call.callee;

  // store.sql("name") / store.kv(...) / …
  if (callee.type === "MemberExpression") {
    const member = callee as AstNode & {
      object: AstNode;
      property: AstNode;
    };
    const obj = identifierName(member.object);
    const prop = identifierName(member.property);

    if (obj === "store" && prop) {
      const facets = ["sql", "kv", "files", "index"] as const;
      if ((facets as readonly string[]).includes(prop)) {
        const facet = prop as (typeof facets)[number];
        const storeName = stringArg(call.arguments[0]) ?? "store";
        const ref = `${facet}:${storeName}` as const;
        const bindingName = enclosingConstName(call, program);
        const storeOpts = objectArg(call.arguments[1]);
        const description = stringProp(storeOpts, "description");
        scope.stores[storeName] = scope.stores[storeName] ?? { facet };
        const storeEntry = scope.stores[storeName]!;
        if (description) {
          storeEntry.description = description;
        }
        if (facet === "sql") {
          attachSchemaOption(call.arguments[1], storeEntry, scope);
        } else if (facet === "kv") {
          const namespaces = new Set(storeEntry.namespaces ?? []);
          namespaces.add(storeName);
          storeEntry.namespaces = [...namespaces].sort();
          if (boolProp(storeOpts, "durable")) storeEntry.durable = true;
        } else if (facet === "files") {
          const buckets = new Set(storeEntry.buckets ?? []);
          buckets.add(storeName);
          storeEntry.buckets = [...buckets].sort();
        } else {
          const indexes = new Set(storeEntry.indexes ?? []);
          indexes.add(storeName);
          storeEntry.indexes = [...indexes].sort();
        }
        if (bindingName) {
          scope.bindings.set(bindingName, {
            kind: "store",
            ref,
            facet,
          });
        }
      }

      // store.resource(db, table, { … }) — remember for on(http.resource(…))
      if (prop === "resource") {
        const bindingName = enclosingConstName(call, program);
        const dbName = identifierName(call.arguments[0]);
        const storeBinding = dbName ? scope.bindings.get(dbName) : undefined;
        const ref =
          storeBinding?.kind === "store" ? storeBinding.ref : (`sql:${dbName ?? "store"}` as const);
        const storeName = ref.split(":")[1] ?? dbName ?? "store";
        const opts = objectArg(call.arguments[2]);
        const breaking = opts ? boolProp(opts, "breaking") === true : false;
        if (bindingName) {
          scope.resources.set(bindingName, {
            storeName,
            storeRef: ref,
            ...(breaking ? { breaking: true } : {}),
          });
        }
      }
    }

    // store.schema.table("notes", { … })
    if (prop === "table" && member.object.type === "MemberExpression") {
      const inner = member.object as AstNode & { object: AstNode; property: AstNode };
      if (identifierName(inner.object) === "store" && identifierName(inner.property) === "schema") {
        collectSchemaTable(call, program, scope);
      }
    }

    if (obj === "gate" && prop === "policy") {
      const policyName = stringArg(call.arguments[0]);
      if (policyName) {
        const opts = objectArg(call.arguments[1]);
        const description = stringProp(opts, "description");
        scope.gates[policyName] = {
          kind: "policy",
          roles: [policyName],
          ...(description ? { description } : {}),
        };
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.gateIds.set(bindingName, policyName);
          scope.bindings.set(bindingName, {
            kind: "unknown",
            ref: policyName,
          });
        }
      }
    }

    if (obj === "gate" && prop === "scope") {
      const scopeName = stringArg(call.arguments[0]);
      if (scopeName) {
        scope.gates[scopeName] = {
          kind: "policy",
          roles: [scopeName],
          scopes: [scopeName],
        };
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.gateIds.set(bindingName, scopeName);
          scope.bindings.set(bindingName, {
            kind: "unknown",
            ref: scopeName,
          });
        }
      }
    }

    if (obj === "gate" && prop === "all") {
      const members = call.arguments
        .map((arg) => identifierName(unwrapTsExpr(arg)))
        .filter((id): id is string => Boolean(id));
      const bindingName = enclosingConstName(call, program);
      if (bindingName && members.length > 0) {
        scope.gateAllIds.set(bindingName, members);
        scope.gateAllDecls.add(bindingName);
      }
    }

    if (obj === "gate" && prop === "rate") {
      const opts = objectArg(call.arguments[0]);
      const strategy = (stringProp(opts, "strategy") ?? "sliding-window-counter") as RateStrategy;
      const max = numberProp(opts, "max");
      const per = stringProp(opts, "per");
      const keyBy = stringProp(opts, "keyBy");
      const description = stringProp(opts, "description");
      if (max !== undefined && per) {
        const expr = `rate:${strategy}:${max}/${per}`;
        const bindingName = enclosingConstName(call, program);
        const rateGate = {
          kind: "rate" as const,
          strategy,
          max,
          per,
          ...(keyBy ? { keyBy } : {}),
          ...(description ? { description } : {}),
        };
        if (bindingName) {
          scope.gates[bindingName] = rateGate;
          scope.gateIds.set(bindingName, expr);
        } else {
          scope.gates[expr] = rateGate;
        }
      }
    }

    // channel.email(…) / .sms(…) / .whatsapp(…) / .push(…) — medium binder,
    // usually held in a local const and called later as `mail.template(…)`.
    if (obj === "channel" && prop && CHANNEL_MEDIUM_METHODS.has(prop)) {
      const bindingName = enclosingConstName(call, program);
      if (bindingName) {
        scope.channelMediumBindings.set(bindingName, prop as ChannelMedium);
      }
    }

    const boundMedium = obj ? scope.channelMediumBindings.get(obj) : undefined;
    if ((obj === "channel" && prop === "template") || (prop === "template" && boundMedium)) {
      const templateName = stringArg(call.arguments[0]);
      const opts = objectArg(call.arguments[1]);
      if (templateName) {
        const medium = stringProp(opts, "medium");
        const locales = stringArrayProp(opts, "locales");
        const description = stringProp(opts, "description");
        scope.channels[templateName] = {
          ...(medium
            ? { medium: medium as Channel["medium"] }
            : { medium: boundMedium ?? "email" }),
          ...(locales ? { locales } : {}),
          ...(description ? { description } : {}),
        };
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.bindings.set(bindingName, {
            kind: "template",
            ref: templateName,
          });
        }
      }
    }

    if (obj === "ai" && prop === "model") {
      const modelName = stringArg(call.arguments[0]);
      const opts = objectArg(call.arguments[1]);
      if (modelName) {
        const model: AiModel = {
          ...(stringProp(opts, "provider") ? { provider: stringProp(opts, "provider") } : {}),
          ...(stringProp(opts, "tier") ? { tier: stringProp(opts, "tier") } : {}),
        };
        scope.ai.models = scope.ai.models ?? {};
        scope.ai.models[modelName] = model;
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.bindings.set(bindingName, {
            kind: "unknown",
            ref: modelName,
          });
        }
      }
    }

    if (obj === "ai" && prop === "agent") {
      collectAgent(call, scope);
    }

    if (obj === "ai" && prop === "embed") {
      const embedName = stringArg(call.arguments[0]);
      if (embedName) {
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.bindings.set(bindingName, {
            kind: "embed",
            ref: embedName,
            facet: "index",
          });
        }
      }
    }

    // model.prompt("ticket-triage", { version, evals, budget, via, timeout })
    if (prop === "prompt") {
      const promptName = stringArg(call.arguments[0]);
      const opts = objectArg(call.arguments[1]);
      if (promptName) {
        const version = numberProp(opts, "version");
        const evals = stringProp(opts, "evals");
        const budgetObj = objectProp(opts, "budget");
        const via = stringArrayProp(opts, "via");
        const timeoutStr = stringProp(opts, "timeout");
        const timeoutNum = numberProp(opts, "timeout");
        const timeout = timeoutStr ?? timeoutNum;
        const prompt: AiPrompt = {
          ...(version !== undefined ? { version } : {}),
          ...(evals ? { evals } : {}),
          ...(budgetObj
            ? {
                budget: {
                  ...(numberProp(budgetObj, "maxCostPerCall") !== undefined
                    ? {
                        maxCostPerCall: numberProp(budgetObj, "maxCostPerCall"),
                      }
                    : {}),
                  ...(numberProp(budgetObj, "maxCostPerRun") !== undefined
                    ? {
                        maxCostPerRun: numberProp(budgetObj, "maxCostPerRun"),
                      }
                    : {}),
                },
              }
            : {}),
          ...(via && via.length > 0 ? { via } : {}),
          ...(timeout !== undefined ? { timeout } : {}),
        };
        scope.ai.prompts = scope.ai.prompts ?? {};
        scope.ai.prompts[promptName] = prompt;
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.bindings.set(bindingName, {
            kind: "prompt",
            ref: promptName,
            version,
          });
        }
      }
    }

    if (obj === "vault" && (prop === "secret" || prop === "define" || prop === "config")) {
      const secretName = stringArg(call.arguments[0]);
      const opts = objectArg(call.arguments[1]);
      if (secretName) {
        scope.vault[secretName] = {
          ...(stringProp(opts, "description")
            ? { description: stringProp(opts, "description") }
            : {}),
          ...(stringProp(opts, "rotate") ? { rotate: stringProp(opts, "rotate") } : {}),
          ...(prop === "config" ? { sensitive: false } : {}),
        };
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.bindings.set(bindingName, {
            kind: "secret",
            ref: secretName,
          });
        }
      }
    }
  }

  // signal("name", { delivery, … })
  if (identifierName(callee) === "signal") {
    const signalName = stringArg(call.arguments[0]);
    const opts = objectArg(call.arguments[1]);
    if (signalName) {
      const delivery = stringProp(opts, "delivery") as SignalDelivery | undefined;
      if (delivery) {
        const signal: Signal = {
          delivery,
          ...(stringProp(opts, "description")
            ? { description: stringProp(opts, "description") }
            : {}),
          ...(numberProp(opts, "retries") !== undefined
            ? { retries: numberProp(opts, "retries") }
            : {}),
          ...(boolProp(opts, "deadLetter") !== undefined
            ? { deadLetter: boolProp(opts, "deadLetter") }
            : {}),
        };
        scope.signals[signalName] = signal;
        const bindingName = enclosingConstName(call, program);
        if (bindingName) {
          scope.bindings.set(bindingName, {
            kind: "signal",
            ref: signalName,
          });
        }
      }
    }
  }

  // clock.every("10m") / clock("expire-holds", { every, overridable })
  if (identifierName(callee) === "clock") {
    const name = stringArg(call.arguments[0]);
    const opts = objectArg(call.arguments[1]);
    if (name && opts) {
      scope.clocks[name] = {
        ...(stringProp(opts, "every") ? { every: stringProp(opts, "every") } : {}),
        ...(stringProp(opts, "cron") ? { cron: stringProp(opts, "cron") } : {}),
        ...(boolProp(opts, "overridable") !== undefined
          ? { overridable: boolProp(opts, "overridable") }
          : {}),
        ...(stringProp(opts, "description")
          ? { description: stringProp(opts, "description") }
          : {}),
      };
    }
  }

  // journey("book-a-flight", { slo, composes, path })
  if (identifierName(callee) === "journey") {
    const name = stringArg(call.arguments[0]);
    const opts = objectArg(call.arguments[1]);
    if (name && opts) {
      const sloObj = objectProp(opts, "slo");
      const pathArr = arrayProp(opts, "path");
      const flows = pathArr
        ?.map((el) => {
          const id = identifierName(el);
          if (!id) return stringArg(el);
          return scope.flowExports.get(id) ?? scope.bindings.get(id)?.ref ?? id;
        })
        .filter((x): x is string => typeof x === "string");
      const journey: Journey = {
        ...(sloObj
          ? {
              slo: {
                ...(stringProp(sloObj, "availability")
                  ? { availability: stringProp(sloObj, "availability") }
                  : {}),
              },
            }
          : {}),
        ...(stringProp(opts, "composes") ? { composes: stringProp(opts, "composes") } : {}),
        ...(flows && flows.length > 0 ? { flows } : {}),
      };
      scope.journeys[name] = journey;
    }
  }

  // defineConfig({ drivers, tenancy, i18n, topology, images })
  if (identifierName(callee) === "defineConfig") {
    collectConfig(objectArg(call.arguments[0]), scope);
  }

  // vault("STRIPE_KEY", { … }) — bare call form
  if (identifierName(callee) === "vault") {
    const secretName = stringArg(call.arguments[0]);
    const opts = objectArg(call.arguments[1]);
    if (secretName) {
      scope.vault[secretName] = {
        ...(stringProp(opts, "description")
          ? { description: stringProp(opts, "description") }
          : {}),
        ...(stringProp(opts, "rotate") ? { rotate: stringProp(opts, "rotate") } : {}),
      };
      const bindingName = enclosingConstName(call, program);
      if (bindingName) {
        scope.bindings.set(bindingName, { kind: "secret", ref: secretName });
      }
    }
  }
}

function collectAgent(call: CallExpression, scope: ProjectScope): void {
  const agentName = stringArg(call.arguments[0]);
  const opts = objectArg(call.arguments[1]);
  if (!agentName || !opts) return;
  const toolsArr = arrayProp(opts, "tools");
  const tools = toolsArr
    ?.map((el) => identifierName(el) ?? stringArg(el))
    .filter((x): x is string => typeof x === "string")
    .map((id) => scope.flowExports.get(id) ?? scope.bindings.get(id)?.ref ?? id);
  const agent: AiAgent = {
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(numberProp(opts, "maxSteps") !== undefined
      ? { maxSteps: numberProp(opts, "maxSteps") }
      : {}),
  };
  scope.ai.agents = scope.ai.agents ?? {};
  scope.ai.agents[agentName] = agent;
}

function collectConfig(opts: AstNode | undefined, scope: ProjectScope): void {
  if (!opts) return;

  const tenancy = objectProp(opts, "tenancy");
  if (tenancy) {
    const isolation = stringProp(tenancy, "isolation");
    if (isolation === "row" || isolation === "schema" || isolation === "database") {
      scope.tenancy = { isolation };
    }
  }

  const i18n = objectProp(opts, "i18n");
  if (i18n) {
    scope.i18n = {
      ...(stringArrayProp(i18n, "locales") ? { locales: stringArrayProp(i18n, "locales") } : {}),
      ...(stringProp(i18n, "default") ? { default: stringProp(i18n, "default") } : {}),
    };
    const dir = objectProp(i18n, "dir");
    if (dir && dir.type === "ObjectExpression") {
      const dirMap: Record<string, "ltr" | "rtl"> = {};
      for (const prop of objectProperties(dir)) {
        const key = propKey(prop);
        const val = stringArg((prop as AstNode & { value?: AstNode }).value);
        if (key && (val === "ltr" || val === "rtl")) dirMap[key] = val;
      }
      if (Object.keys(dirMap).length > 0) {
        scope.i18n = { ...scope.i18n, dir: dirMap };
      }
    }
  }

  const topology = stringProp(opts, "topology");
  if (topology === "monolith" || topology === "services") {
    scope.topology = topology;
  }

  const images = objectProp(opts, "images");
  if (images) {
    const map: Record<string, string> = {};
    // Nested like `drivers`: `store.*` / `channel.*` flatten to dotted keys;
    // everything else (`vault`, `ai`, `pgdog`, `proxy`) is already flat.
    for (const nestKey of ["store", "channel"] as const) {
      const nested = objectProp(images, nestKey);
      if (!nested || nested.type !== "ObjectExpression") continue;
      for (const prop of objectProperties(nested)) {
        const key = propKey(prop);
        const val = stringArg((prop as AstNode & { value?: AstNode }).value);
        if (key && val) map[`${nestKey}.${key}`] = val;
      }
    }
    for (const prop of objectProperties(images)) {
      const key = propKey(prop);
      if (key === "store" || key === "channel") continue;
      const val = stringArg((prop as AstNode & { value?: AstNode }).value);
      if (key && val) map[key] = val;
    }
    if (Object.keys(map).length > 0) scope.images = map;
  }

  // drivers: prefer an explicit prod string[], else flatten nested role maps.
  const drivers = objectProp(opts, "drivers");
  if (drivers) {
    const prodArr = arrayProp(drivers, "prod");
    if (prodArr && prodArr.length > 0 && prodArr.every((el) => stringArg(el))) {
      scope.drivers.prod = prodArr.map((el) => stringArg(el)!).filter((x) => x.length > 0);
    } else {
      const prod = new Set<string>();
      collectDriverProtocols(drivers, "prod", prod);
      if (prod.size > 0) scope.drivers.prod = [...prod];
    }
  }
}

function collectDriverProtocols(node: AstNode, env: string, into: Set<string>): void {
  if (node.type !== "ObjectExpression") return;
  for (const prop of objectProperties(node)) {
    const key = propKey(prop);
    const value = (prop as AstNode & { value?: AstNode }).value;
    if (!value) continue;

    if (key === env) {
      if (value.type === "Literal" && typeof (value as Literal).value === "string") {
        into.add((value as Literal).value as string);
      } else if (value.type === "ObjectExpression") {
        const driver = stringProp(value, "driver");
        if (driver) into.add(driver);
        // Nested role objects may also use env keys.
        collectDriverProtocols(value, env, into);
      }
      continue;
    }

    if (value.type === "ObjectExpression") {
      // role: { dev, test, prod } or nested store: { sql: { prod } }
      const envVal = objectProp(value, env);
      if (envVal) {
        if (envVal.type === "Literal" && typeof (envVal as Literal).value === "string") {
          into.add((envVal as Literal).value as string);
        } else if (envVal.type === "ObjectExpression") {
          const driver = stringProp(envVal, "driver");
          if (driver) into.add(driver);
        }
      } else {
        collectDriverProtocols(value, env, into);
      }
    }
  }
}

function collectFlows(file: SourceFile, program: AstNode, scope: ProjectScope): void {
  walk(program, (node) => {
    if (node.type !== "CallExpression") return;
    const call = node as CallExpression;
    const callee = identifierName(call.callee);

    if (callee === "on") {
      const triggerNode = call.arguments[0];
      const flowNode = call.arguments[1];
      if (!triggerNode) return;

      // on(http.resource(path, bag)) — expand the mount into five bindings.
      if (!flowNode) {
        registerResourceMount(call, triggerNode, file, program, scope);
        return;
      }

      const flowCall = unwrapFlowCall(flowNode);
      if (!flowCall) return;
      const exportName = enclosingConstName(call, program);
      registerFlow({
        flowCall,
        triggerNode,
        file,
        scope,
        exportName,
      });
      return;
    }

    if (callee === "flow") {
      // Bare flow — skip when this call is the second arg of an on().
      if (isOnFlowArgument(call, program)) return;
      const exportName = enclosingConstName(call, program);
      registerFlow({
        flowCall: call,
        triggerNode: undefined,
        file,
        scope,
        exportName,
      });
      return;
    }

    // bindNamedTableCrud / bindCrud({ unit, path, table }) — expand like http.resource.
    if (callee === "bindNamedTableCrud" || callee === "bindCrud") {
      registerNamedTableCrud(call, file, scope);
    }
  });
}

function isOnFlowArgument(flowCall: CallExpression, program: AstNode): boolean {
  const targetStart = flowCall.start;
  if (targetStart === undefined) return false;
  let found = false;
  walk(program, (node) => {
    if (found) return;
    if (node.type !== "CallExpression") return;
    const call = node as CallExpression;
    if (identifierName(call.callee) !== "on") return;
    const arg = call.arguments[1];
    if (arg && arg.type === "CallExpression" && arg.start === targetStart) {
      found = true;
    }
  });
  return found;
}

function unwrapFlowCall(node: AstNode): CallExpression | undefined {
  if (
    node.type === "CallExpression" &&
    identifierName((node as CallExpression).callee) === "flow"
  ) {
    return node as CallExpression;
  }
  return undefined;
}

function registerFlow(args: {
  flowCall: CallExpression;
  triggerNode: AstNode | undefined;
  file: SourceFile;
  scope: ProjectScope;
  exportName: string | undefined;
}): void {
  const opts = objectArg(args.flowCall.arguments[1]);
  if (!opts) return;

  // `flow(\`${unit}.list\`)` inside a helper — name is only known at the
  // call site (`bindNamedTableCrud`). Do not register as `list` / `create`.
  if (isInterpolatedTemplate(args.flowCall.arguments[0])) return;

  const name =
    stringArg(args.flowCall.arguments[0]) ??
    args.exportName ??
    `flow_${Object.keys(args.scope.flows).length + 1}`;

  if (args.exportName) {
    args.scope.flowExports.set(args.exportName, name);
    args.scope.bindings.set(args.exportName, { kind: "flow", ref: name });
  }
  args.scope.bindings.set(name, { kind: "flow", ref: name });

  const hasExplicitEffects = objectProp(opts, "effects") !== undefined;
  const doNode = objectProp(opts, "do");
  const inferred = doNode
    ? inferEffects({
        doNode,
        bindings: args.scope.bindings,
        hasExplicitEffects,
      })
    : {
        effects: {} as Effects,
        steps: [] as string[],
        usesRaw: false,
        cacheIneligible: false,
        nondeterministic: false,
        readsUserId: false,
      };

  let effects: Effects | undefined;
  if (hasExplicitEffects) {
    effects = parseEffectsObject(objectProp(opts, "effects"));
  } else {
    effects = inferred.effects;
  }

  // Spec excerpt includes empty secrets[] when other keys present for create.
  if (
    effects &&
    (effects.reads || effects.writes || effects.emits) &&
    effects.secrets === undefined &&
    !inferred.usesRaw
  ) {
    // Keep secrets omitted unless the excerpt-style empty list is needed —
    // only add empty secrets when emits are present (bookings.create shape).
    if (effects.emits && effects.emits.length > 0) {
      effects = { ...effects, secrets: [] };
    }
  }

  const trigger = args.triggerNode ? parseTrigger(args.triggerNode, args.scope) : undefined;

  const gates = trigger?.gates;
  const liveFromTrigger = trigger?.live;
  const manifestTrigger = trigger ? stripTriggerExtras(trigger.trigger) : undefined;

  const flow: Flow = {};

  if (manifestTrigger && Object.keys(manifestTrigger).length > 0) {
    flow.trigger = manifestTrigger;
  }
  if (gates && gates.length > 0) flow.gates = gates;

  const inSchema = schemaProp(opts, "in");
  if (inSchema !== undefined) flow.in = inSchema;
  const outSchema = schemaProp(opts, "out");
  if (outSchema !== undefined) flow.out = outSchema;

  const errors = parseErrors(objectProp(opts, "errors"));
  if (errors) flow.errors = errors;

  if (effects) flow.effects = effects;

  const line = lineAt(args.file.source, args.flowCall.start ?? 0);
  flow.source = `${args.file.path}:${line}`;

  if (boolProp(opts, "durable")) flow.durable = true;
  if (boolProp(opts, "live") || liveFromTrigger) flow.live = true;
  if (boolProp(opts, "breaking")) flow.breaking = true;

  const slo = parseSlo(objectProp(opts, "slo"));
  if (slo) flow.slo = slo;

  const stepsFromOpts = stringArrayProp(opts, "steps");
  const steps = stepsFromOpts && stepsFromOpts.length > 0 ? stepsFromOpts : inferred.steps;
  if (steps.length > 0) flow.steps = steps;

  if (boolProp(opts, "nondeterministic") || inferred.nondeterministic) {
    flow.nondeterministic = true;
  }

  const cost = objectProp(opts, "cost");
  if (cost) {
    flow.cost = {
      ...(numberProp(cost, "estimatePerCall") !== undefined
        ? { estimatePerCall: numberProp(cost, "estimatePerCall") }
        : {}),
      ...(numberProp(cost, "budget") !== undefined ? { budget: numberProp(cost, "budget") } : {}),
    };
  } else if (inferred.nondeterministic) {
    // Derive budget from the first ask prompt when present.
    const ask = effects?.asks?.[0];
    if (ask) {
      const promptName = ask.split("@")[0]!;
      const promptBudget = args.scope.ai.prompts?.[promptName]?.budget?.maxCostPerCall;
      if (promptBudget !== undefined) {
        flow.cost = {
          estimatePerCall: Number((promptBudget * 0.55).toFixed(3)),
          budget: promptBudget,
        };
      }
    }
  }

  const pii = stringProp(opts, "pii");
  if (pii === "masked" || pii === "allow" || pii === "denied") {
    flow.pii = pii;
  } else if (inferred.nondeterministic) {
    flow.pii = "masked";
  }
  if (boolProp(opts, "allowPii") === true || pii === "allow") {
    flow.allowPii = true;
    flow.pii = "allow";
  }

  const plane = stringProp(opts, "plane");
  if (plane === "user" || plane === "operator") flow.plane = plane;

  if (inferred.cacheIneligible) {
    flow.cache = false;
  } else {
    const cache = (opts && objectProperties(opts).find((p) => propKey(p) === "cache")) as
      | AstNode
      | undefined;
    if (cache) {
      const val = (cache as AstNode & { value?: AstNode }).value;
      if (val?.type === "Literal") {
        const v = (val as Literal).value;
        if (typeof v === "boolean" || typeof v === "string") flow.cache = v;
      }
    }
  }

  const cacheKeys = stringProp(opts, "cacheKeys");
  if (cacheKeys) {
    flow.cacheKeys = cacheKeys;
  } else if (flow.live && inferred.readsUserId && effects?.reads?.[0]) {
    flow.cacheKeys = `computed:${effects.reads[0]}/userId`;
  }

  args.scope.flows[name] = flow;
}

/**
 * `http.resource(path, bag).gate(...).live()` — find the resource call and
 * collect the same chain {@link parseHttpTrigger} reads on a single verb.
 *
 * @param node - First argument to `on(…)`
 * @param scope - Project scope (gate name expansion)
 */
function unwrapResourceMount(
  node: AstNode,
  scope: ProjectScope,
): { httpCall: CallExpression; gates?: string[]; live?: boolean } | undefined {
  const chain = flattenMemberCallChain(node);
  let httpCall: CallExpression | undefined;
  const gateNames: string[] = [];
  let live = false;
  for (const item of chain) {
    if (item.type === "CallExpression") {
      const c = item as CallExpression;
      const callee = c.callee;
      if (callee.type !== "MemberExpression") continue;
      const member = callee as AstNode & { object: AstNode; property: AstNode };
      const prop = identifierName(member.property);
      const obj = member.object;
      if (obj.type === "Identifier" && identifierName(obj) === "http" && prop === "resource") {
        httpCall = c;
        continue;
      }
      if (prop === "gate") {
        for (const arg of c.arguments) {
          gateNames.push(...gateNamesFromArg(arg, scope));
        }
        continue;
      }
      if (prop === "live") live = true;
      continue;
    }
    if (item.type === "MemberExpression") {
      const member = item as AstNode & { object: AstNode; property: AstNode };
      if (identifierName(member.property) !== "public") continue;
      const obj = member.object;
      if (
        obj.type === "MemberExpression" &&
        identifierName((obj as AstNode & { property: AstNode }).property) === "gate"
      ) {
        gateNames.push("public");
      }
    }
  }
  if (!httpCall) return undefined;
  return {
    httpCall,
    gates: gateNames.length > 0 ? gateNames : undefined,
    live: live || undefined,
  };
}

/**
 * Expand `on(http.resource(path, bag))` into the five CRUD flows.
 *
 * The flows are synthesized at runtime by `store.resource(…)`; statically we
 * register list/create/get/update/remove with their HTTP triggers and the
 * resource's store effects so the Manifest stays complete.
 *
 * @param onCall - The outer `on(…)` call
 * @param triggerNode - `http.resource(…)` expression
 * @param file - Source file
 * @param program - Program root (for export-name lookup)
 * @param scope - Project scope
 */
function registerResourceMount(
  onCall: CallExpression,
  triggerNode: AstNode,
  file: SourceFile,
  program: AstNode,
  scope: ProjectScope,
): void {
  const parsed = unwrapResourceMount(triggerNode, scope);
  if (!parsed) return;
  const { httpCall, gates, live } = parsed;

  const path = stringArg(httpCall.arguments[0]);
  if (!path) return;

  // bag: `notesR.all()` → resolve `notesR` to its store.resource declaration.
  const bagNode = httpCall.arguments[1];
  let baseName: string | undefined;
  if (bagNode?.type === "CallExpression") {
    const bagCallee = (bagNode as CallExpression).callee;
    if (bagCallee.type === "MemberExpression") {
      baseName = identifierName((bagCallee as AstNode & { object: AstNode }).object);
    }
  } else if (bagNode?.type === "Identifier") {
    baseName = identifierName(bagNode);
  }
  const resource = baseName ? scope.resources.get(baseName) : undefined;

  const storeRef: ResourceRef | undefined =
    resource?.storeRef !== undefined ? (resource.storeRef as ResourceRef) : undefined;
  const effects: Effects | undefined = storeRef
    ? { reads: [storeRef], writes: [storeRef] }
    : undefined;
  const idPath = `${path}/:id`;
  const line = lineAt(file.source, onCall.start ?? 0);

  const verbs = [
    { op: "list", method: "GET", p: path, eff: storeRef ? { reads: [storeRef] } : undefined },
    { op: "create", method: "POST", p: path, eff: storeRef ? { writes: [storeRef] } : undefined },
    { op: "get", method: "GET", p: idPath, eff: storeRef ? { reads: [storeRef] } : undefined },
    { op: "update", method: "PATCH", p: idPath, eff: effects },
    {
      op: "remove",
      method: "DELETE",
      p: idPath,
      eff: storeRef ? { writes: [storeRef] } : undefined,
    },
  ] as const;

  for (const v of verbs) {
    // Short op names match `export const list = mounted.list` so Manifest Diff
    // keeps flow identity across a handwritten → store.resource migration.
    const name = v.op;
    const flow: Flow = {
      trigger: { http: { method: v.method as never, path: v.p } },
      ...(v.eff ? { effects: v.eff as Effects } : {}),
      ...(gates && gates.length > 0 ? { gates } : {}),
      ...(live && v.method === "GET" ? { live: true } : {}),
      ...(resource?.breaking ? { breaking: true } : {}),
      source: `${file.path}:${line}`,
    };
    scope.flows[name] = flow;
    scope.bindings.set(name, { kind: "flow", ref: name });
  }

  const exportName = enclosingConstName(onCall, program);
  if (exportName) {
    scope.bindings.set(exportName, { kind: "flow", ref: baseName ?? exportName });
  }
}

/**
 * Expand `bindNamedTableCrud` / `bindCrud({ unit, path, table })` into the
 * five CRUD flows. The helper builds `flow(\`${unit}.list\`)` at runtime;
 * statically we register the same names + inferred table effects so
 * docker/prod can stamp tokens without a hand-declared `effects` object.
 *
 * @param call - The `bindNamedTableCrud` / `bindCrud(…)` call
 * @param file - Source file
 * @param scope - Project scope
 */
function registerNamedTableCrud(call: CallExpression, file: SourceFile, scope: ProjectScope): void {
  const opts = objectArg(call.arguments[0]);
  if (!opts) return;
  const unit = stringProp(opts, "unit");
  const path = stringProp(opts, "path");
  if (!unit || !path) return;

  const tableId = identifierName(objectProp(opts, "table"));
  const tableBinding = tableId ? scope.bindings.get(tableId) : undefined;
  const tableName = tableBinding?.kind === "table" ? tableBinding.ref : tableId;
  const storeRef: ResourceRef | undefined = tableName ? sqlTableRef(tableName) : undefined;
  const both: Effects | undefined = storeRef
    ? { reads: [storeRef], writes: [storeRef] }
    : undefined;
  const idPath = `${path}/:id`;
  const line = lineAt(file.source, call.start ?? 0);
  const live = boolProp(opts, "liveList") === true;

  const verbs = [
    {
      op: "list",
      method: "GET",
      p: path,
      eff: storeRef ? { reads: [storeRef] } : undefined,
      live,
    },
    { op: "create", method: "POST", p: path, eff: storeRef ? { writes: [storeRef] } : undefined },
    { op: "get", method: "GET", p: idPath, eff: storeRef ? { reads: [storeRef] } : undefined },
    { op: "update", method: "PATCH", p: idPath, eff: both },
    {
      op: "delete",
      method: "DELETE",
      p: idPath,
      eff: storeRef ? { reads: [storeRef], writes: [storeRef] } : undefined,
    },
  ] as const;

  for (const v of verbs) {
    const name = `${unit}.${v.op}`;
    const flow: Flow = {
      trigger: { http: { method: v.method as never, path: v.p } },
      ...(v.eff ? { effects: v.eff as Effects } : {}),
      ...("live" in v && v.live ? { live: true } : {}),
      source: `${file.path}:${line}`,
    };
    scope.flows[name] = flow;
    scope.bindings.set(name, { kind: "flow", ref: name });
  }
}

interface ParsedTrigger {
  trigger: Trigger;
  gates?: string[];
  live?: boolean;
}

function parseTrigger(node: AstNode, scope: ProjectScope): ParsedTrigger | undefined {
  // every("10m")
  if (node.type === "CallExpression") {
    const call = node as CallExpression;
    const name = identifierName(call.callee);
    if (name === "every") {
      const interval = stringArg(call.arguments[0]);
      if (interval) return { trigger: { every: interval } };
    }
    if (name === "internal") {
      return { trigger: {} };
    }

    // http.post("/x").gate(...).live() / http.get("/x").gate.public
    const http = parseHttpTrigger(call, scope);
    if (http) return http;

    // table("orders").changed("status") / db.table(orders).changed(...)
    const cdc = parseCdcTrigger(call);
    if (cdc) return { trigger: { cdc } };

    // on(signalHandle, …) — Identifier referring to a signal binding
  }

  if (node.type === "MemberExpression") {
    const http = parseHttpTrigger(node, scope);
    if (http) return http;
  }

  if (node.type === "Identifier") {
    const id = (node as Identifier).name;
    if (id === "internal") return { trigger: {} };
    const binding = scope.bindings.get(id);
    if (binding?.kind === "signal") {
      return { trigger: { signal: binding.ref } };
    }
    if (scope.signals[id]) return { trigger: { signal: id } };
    return { trigger: { signal: id } };
  }

  return undefined;
}

function parseHttpTrigger(leaf: AstNode, scope: ProjectScope): ParsedTrigger | undefined {
  // Walk: http.METHOD(path).gate(...).live() / .gate.public
  const chain = flattenMemberCallChain(leaf);
  let method: string | undefined;
  let path: string | undefined;
  let live = false;
  const gateNames: string[] = [];

  for (const node of chain) {
    if (node.type === "CallExpression") {
      const c = node as CallExpression;
      const callee = c.callee;
      if (callee.type !== "MemberExpression") continue;
      const member = callee as AstNode & { object: AstNode; property: AstNode };
      const prop = identifierName(member.property);
      const obj = member.object;

      if (obj.type === "Identifier" && (obj as Identifier).name === "http" && prop) {
        method = prop.toUpperCase();
        path = stringArg(c.arguments[0]);
        continue;
      }

      if (prop === "gate") {
        for (const arg of c.arguments) {
          gateNames.push(...gateNamesFromArg(arg, scope));
        }
        continue;
      }

      if (prop === "live") live = true;
      continue;
    }

    if (node.type === "MemberExpression") {
      const member = node as AstNode & { object: AstNode; property: AstNode };
      if (identifierName(member.property) !== "public") continue;
      const obj = member.object;
      if (
        obj.type === "MemberExpression" &&
        identifierName((obj as AstNode & { property: AstNode }).property) === "gate"
      ) {
        gateNames.push("public");
      }
    }
  }

  if (!method || !path) return undefined;

  const httpMethods = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD",
    "OPTIONS",
    "QUERY",
  ] as const;
  if (!(httpMethods as readonly string[]).includes(method)) return undefined;

  return {
    trigger: {
      http: {
        method: method as (typeof httpMethods)[number],
        path,
      },
    },
    gates: gateNames.length > 0 ? gateNames : undefined,
    live: live || undefined,
  };
}

function parseCdcTrigger(call: CallExpression): Trigger["cdc"] | undefined {
  // *.changed("col") or *.changed()
  const callee = call.callee;
  if (callee.type !== "MemberExpression") return undefined;
  const member = callee as AstNode & { object: AstNode; property: AstNode };
  if (identifierName(member.property) !== "changed") return undefined;

  const column = stringArg(call.arguments[0]);
  // object is table("orders") or db.table(orders) or table(orders)
  const obj = member.object;
  if (obj.type === "CallExpression") {
    const inner = obj as CallExpression;
    const innerCallee = inner.callee;
    if (identifierName(innerCallee) === "table") {
      const tableName = stringArg(inner.arguments[0]) ?? identifierName(inner.arguments[0]);
      if (!tableName) return undefined;
      return column ? { table: tableName, column } : { table: tableName };
    }
    if (
      innerCallee.type === "MemberExpression" &&
      identifierName((innerCallee as AstNode & { property: AstNode }).property) === "table"
    ) {
      const tableName = stringArg(inner.arguments[0]) ?? identifierName(inner.arguments[0]);
      if (!tableName) return undefined;
      return column ? { table: tableName, column } : { table: tableName };
    }
  }
  return undefined;
}

function stripTriggerExtras(trigger: Trigger): Trigger {
  return trigger;
}

function parseEffectsObject(node: AstNode | undefined): Effects | undefined {
  if (!node) return undefined;
  const effects: Effects = {};
  const reads = stringArrayProp(node, "reads");
  const writes = stringArrayProp(node, "writes");
  const emits = stringArrayProp(node, "emits");
  const sends = stringArrayProp(node, "sends");
  const asks = stringArrayProp(node, "asks");
  const secrets = stringArrayProp(node, "secrets");
  const calls = stringArrayProp(node, "calls");
  if (reads) effects.reads = reads as Effects["reads"];
  if (writes) effects.writes = writes as Effects["writes"];
  if (emits) effects.emits = emits;
  if (sends) effects.sends = sends;
  if (asks) effects.asks = asks;
  if (secrets) effects.secrets = secrets;
  if (calls) effects.calls = calls;
  return effects;
}

function parseErrors(node: AstNode | undefined): Flow["errors"] | undefined {
  if (!node) return undefined;
  if (node.type === "ObjectExpression") {
    const names: string[] = [];
    for (const prop of objectProperties(node)) {
      const key = propKey(prop);
      if (key) names.push(key);
    }
    return names.length > 0 ? names : undefined;
  }
  if (node.type === "ArrayExpression") {
    const els = (node as AstNode & { elements?: AstNode[] }).elements ?? [];
    const names = els
      .map((el) => stringArg(el) ?? identifierName(el))
      .filter((x): x is string => typeof x === "string");
    return names.length > 0 ? names : undefined;
  }
  return undefined;
}

function parseSlo(node: AstNode | undefined): Slo | undefined {
  if (!node) return undefined;
  const availability = stringProp(node, "availability");
  const latencyObj = objectProp(node, "latency");
  const latency: Record<string, string> = {};
  if (latencyObj) {
    for (const prop of objectProperties(latencyObj)) {
      const key = propKey(prop);
      const val = stringArg((prop as AstNode & { value?: AstNode }).value);
      if (key && val) latency[key] = val;
    }
  }
  if (!availability && Object.keys(latency).length === 0) return undefined;
  return {
    ...(availability ? { availability } : {}),
    ...(Object.keys(latency).length > 0 ? { latency } : {}),
  };
}

function schemaProp(obj: AstNode | undefined, key: string): string | undefined {
  const node = objectProp(obj, key);
  if (!node) return undefined;
  // Identifier / member schemas → opaque placeholder matching the spec excerpt.
  if (node.type === "Identifier" || node.type === "MemberExpression") {
    return "…";
  }
  if (node.type === "CallExpression") return "…";
  const lit = stringArg(node);
  if (lit) return lit;
  return "…";
}

// ── AST helpers ────────────────────────────────────────────────────────────

/** Leaf-to-root walk of `http.get("/x").gate.public.live()`. */
function flattenMemberCallChain(leaf: AstNode): AstNode[] {
  const chain: AstNode[] = [];
  let current: AstNode = leaf;
  while (true) {
    if (current.type === "CallExpression") {
      chain.unshift(current);
      const callee = (current as CallExpression).callee;
      if (callee.type === "MemberExpression") {
        current = (callee as AstNode & { object: AstNode }).object;
        continue;
      }
      break;
    }
    if (current.type === "MemberExpression") {
      chain.unshift(current);
      current = (current as AstNode & { object: AstNode }).object;
      continue;
    }
    break;
  }
  return chain;
}

function unwrapTsExpr(node: AstNode): AstNode {
  if (node.type === "TSAsExpression" || node.type === "TSTypeAssertion") {
    const expr = (node as AstNode & { expression?: AstNode }).expression;
    if (expr) return unwrapTsExpr(expr);
  }
  return node;
}

function arrayMemberNames(node: AstNode): string[] {
  const elements = (node as AstNode & { elements?: readonly (AstNode | null)[] }).elements ?? [];
  const names: string[] = [];
  for (const el of elements) {
    if (!el) continue;
    const id = identifierName(unwrapTsExpr(el));
    if (id) names.push(id);
  }
  return names;
}

function expandGateNames(
  members: readonly string[],
  scope: ProjectScope,
  seen: Set<string>,
): string[] {
  const out: string[] = [];
  for (const member of members) {
    if (seen.has(member)) continue;
    seen.add(member);
    const nested = scope.gateAllIds.get(member);
    if (nested) {
      out.push(...expandGateNames(nested, scope, seen));
      continue;
    }
    out.push(scope.gateIds.get(member) ?? member);
  }
  return out;
}

function gateNamesFromArg(arg: AstNode, scope: ProjectScope): string[] {
  if (arg.type === "SpreadElement") {
    const inner = (arg as AstNode & { argument?: AstNode }).argument;
    if (!inner) return [];
    return gateNamesFromArg(unwrapTsExpr(inner), scope);
  }
  const unwrapped = unwrapTsExpr(arg);
  if (unwrapped.type === "ArrayExpression") {
    return expandGateNames(arrayMemberNames(unwrapped), scope, new Set());
  }
  if (unwrapped.type === "MemberExpression") {
    const member = unwrapped as AstNode & { object: AstNode; property: AstNode };
    if (identifierName(member.object) === "gate" && identifierName(member.property) === "public") {
      return ["public"];
    }
  }
  const id = identifierName(unwrapped);
  if (!id) return [];
  return expandGateNames([id], scope, new Set());
}

function enclosingConstName(call: CallExpression, program: AstNode): string | undefined {
  const targetStart = call.start;
  if (targetStart === undefined) return undefined;
  let found: string | undefined;
  walk(program, (node) => {
    if (found) return;
    if (node.type !== "VariableDeclarator") return;
    const id = (node as AstNode & { id?: AstNode }).id;
    const init = (node as AstNode & { init?: AstNode }).init;
    if (!id || !init) return;
    const name = identifierName(id);
    if (!name) return;
    if (containsOffset(init, targetStart)) found = name;
  });
  return found;
}

function containsOffset(root: AstNode, start: number): boolean {
  let found = false;
  walk(root, (node) => {
    if (node.start === start) found = true;
  });
  return found;
}

function isInterpolatedTemplate(node: AstNode | undefined): boolean {
  if (!node || node.type !== "TemplateLiteral") return false;
  const exprs = (node as AstNode & { expressions?: readonly AstNode[] }).expressions;
  return (exprs?.length ?? 0) > 0;
}

function objectArg(node: AstNode | undefined): AstNode | undefined {
  if (!node) return undefined;
  if (node.type === "ObjectExpression") return node;
  return undefined;
}

function objectProp(obj: AstNode | undefined, key: string): AstNode | undefined {
  if (!obj || obj.type !== "ObjectExpression") return undefined;
  for (const prop of objectProperties(obj)) {
    if (propKey(prop) === key) {
      return (prop as AstNode & { value?: AstNode }).value;
    }
  }
  return undefined;
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

function stringProp(obj: AstNode | undefined, key: string): string | undefined {
  return stringArg(objectProp(obj, key));
}

function numberProp(obj: AstNode | undefined, key: string): number | undefined {
  const node = objectProp(obj, key);
  if (!node || node.type !== "Literal") return undefined;
  const v = (node as Literal).value;
  return typeof v === "number" ? v : undefined;
}

function boolProp(obj: AstNode | undefined, key: string): boolean | undefined {
  const node = objectProp(obj, key);
  if (!node || node.type !== "Literal") return undefined;
  const v = (node as Literal).value;
  return typeof v === "boolean" ? v : undefined;
}

function stringArrayProp(obj: AstNode | undefined, key: string): string[] | undefined {
  const node = objectProp(obj, key);
  if (!node || node.type !== "ArrayExpression") return undefined;
  const els = (node as AstNode & { elements?: AstNode[] }).elements ?? [];
  const out = els.map((el) => stringArg(el)).filter((x): x is string => typeof x === "string");
  return out;
}

function arrayProp(obj: AstNode | undefined, key: string): AstNode[] | undefined {
  const node = objectProp(obj, key);
  if (!node || node.type !== "ArrayExpression") return undefined;
  return ((node as AstNode & { elements?: AstNode[] }).elements ?? []).filter(
    (el): el is AstNode => el !== null && el !== undefined,
  );
}

/**
 * 1-based line number for a byte offset.
 *
 * @param source - Source text
 * @param offset - Byte offset
 */
export function lineAt(source: string, offset: number): number {
  let line = 1;
  const end = Math.min(offset, source.length);
  for (let i = 0; i < end; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(record).sort()) {
    out[key] = record[key]!;
  }
  return out;
}

/**
 * Deep subset match — every key/value in `expected` appears in `actual`.
 *
 * @param actual - Extracted value
 * @param expected - Spec excerpt (or golden subset)
 */
export function deepMatch(actual: unknown, expected: unknown): boolean {
  if (expected === null || typeof expected !== "object") {
    return Object.is(actual, expected);
  }
  if (actual === null || typeof actual !== "object") return false;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    if (expected.length !== actual.length) return false;
    return expected.every((item, i) => deepMatch(actual[i], item));
  }
  const expObj = expected as Record<string, unknown>;
  const actObj = actual as Record<string, unknown>;
  for (const key of Object.keys(expObj)) {
    if (!(key in actObj)) return false;
    if (!deepMatch(actObj[key], expObj[key])) return false;
  }
  return true;
}
