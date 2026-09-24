/**
 * Effect inference v1 — through the `fx` door only.
 *
 * Deep static analysis is a later optimisation. `fx.raw` requires an
 * explicit `effects` annotation on the flow; unannotated raw access marks
 * the flow cache-ineligible rather than silently guessing.
 */

import type {
  AuthApiKeysResourceRef,
  AuthTenantsResourceRef,
  Effects,
  EmbedRef,
  FetchHostRef,
  PromptRef,
  ResourceRef,
  SecretRef,
  SignalRef,
  SignalResourceRef,
  TemplateRef,
  FlowRef,
} from "../manifest/types.ts";
import { sqlTableRef } from "../manifest/sql-resource.ts";

/** Minimal ESTree-shaped nodes produced by oxc-parser. */
export interface AstNode {
  readonly type: string;
  readonly start?: number;
  readonly end?: number;
  readonly [key: string]: unknown;
}

/** CallExpression node. */
export interface CallExpression extends AstNode {
  readonly type: "CallExpression";
  readonly callee: AstNode;
  readonly arguments: readonly AstNode[];
}

/** Identifier node. */
export interface Identifier extends AstNode {
  readonly type: "Identifier";
  readonly name: string;
}

/** Literal node. */
export interface Literal extends AstNode {
  readonly type: "Literal";
  readonly value: string | number | boolean | null;
}

/** Binding known to the extractor (stores, signals, prompts, …). */
export interface InferBinding {
  /** Kind of binding. */
  readonly kind:
    | "store"
    | "signal"
    | "clock"
    | "prompt"
    | "agent"
    | "secret"
    | "template"
    | "flow"
    | "embed"
    | "decision"
    | "table"
    | "mcp-server"
    | "mcp-tool"
    | "unknown";
  /** Resolved resource / name. */
  readonly ref: string;
  /** Store facet when kind is `store`. */
  readonly facet?: "sql" | "kv" | "files" | "index";
  /** Prompt version when kind is `prompt`. */
  readonly version?: number;
  /** Nested agent tools when kind is `agent`. */
  readonly agentCalls?: readonly string[];
}

/** What a callee that is passed `fx` resolves to. */
export type FxCalleeResolution =
  | { readonly kind: "function"; readonly fn: AstNode; readonly file?: string }
  | { readonly kind: "intrinsic"; readonly name: "liveQuery" | "applySearchEmbedCdc" }
  | { readonly kind: "unresolved"; readonly label: string };

/** Options for {@link inferEffects}. */
export interface InferEffectsOptions {
  /** The `do` handler AST node (function / arrow). */
  readonly doNode: AstNode;
  /** Local name → binding (from the project scope). */
  readonly bindings: ReadonlyMap<string, InferBinding>;
  /**
   * True when the flow options already declare an `effects` object.
   * Required for `fx.raw` to stay cache-eligible. Opaque `fx` (a renamed
   * parameter, an escaped chain alias, an unresolved callee) is allowed
   * only when this is set; the declared set must still cover every effect
   * the walk can see.
   */
  readonly hasExplicitEffects: boolean;
  /** Manifest flow name, used in OKE1900. */
  readonly flowName?: string;
  /**
   * Resolve a callee in the flow's file. Absent only for unit tests that
   * never pass `fx` into another function.
   */
  /** File that contains `do`, so imported helpers resolve from there. */
  readonly file?: string;
  /**
   * Resolve a callee as seen from `file`. Absent only for unit tests that
   * never pass `fx` into another function.
   */
  readonly resolveCallee?: (callee: AstNode, file: string) => FxCalleeResolution;
}

/** Result of effect inference for one flow body. */
export interface InferredEffects {
  /** Inferred effect set. */
  readonly effects: Effects;
  /** Named durable steps from `fx.step("…")`. */
  readonly steps: string[];
  /** True when the body calls `fx.raw`. */
  readonly usesRaw: boolean;
  /**
   * True when `fx.raw` appears without an explicit effects annotation —
   * the flow must opt out of auto-caching.
   */
  readonly cacheIneligible: boolean;
  /** True when any `fx.ask` or `fx.embed` was seen (implies nondeterministic). */
  readonly nondeterministic: boolean;
  /** True when the body references `fx.auth.userId`. */
  readonly readsUserId: boolean;
}

const READ_METHODS = new Set([
  "select",
  "get",
  "findById",
  "exists",
  "findMany",
  "findFirst",
  "find",
  "list",
  "ttlMs",
  "count",
  "page",
  "search",
  "raw",
]);

const WRITE_METHODS = new Set([
  "insert",
  "set",
  "delete",
  "increment",
  "update",
  "upsert",
  "log",
  "put",
  "putImage",
]);

/** `fx.vault.*` methods whose first argument is a secret path. */
const VAULT_PATH_METHODS = new Set(["get", "set", "rotate", "delete"]);

/** Methods whose first argument is a table / collection identifier. */
const TABLE_ARG_METHODS = new Set([
  "insert",
  "from",
  "findById",
  "exists",
  "update",
  "upsert",
  "increment",
  "delete",
  "count",
  "page",
  "search",
]);

/**
 * Infer effects for a flow `do` body by walking `fx.*` call sites.
 *
 * @param options - Handler AST, bindings, and annotation flag
 */
export function inferEffects(options: InferEffectsOptions): InferredEffects {
  const reads = new Set<
    ResourceRef | SignalResourceRef | AuthApiKeysResourceRef | AuthTenantsResourceRef
  >();
  const writes = new Set<ResourceRef | AuthApiKeysResourceRef | AuthTenantsResourceRef>();
  const emits = new Set<SignalRef>();
  const sends = new Set<TemplateRef>();
  const asks = new Set<PromptRef>();
  const embeds = new Set<EmbedRef>();
  const secrets = new Set<SecretRef>();
  const calls = new Set<FlowRef>();
  const fetches = new Set<FetchHostRef>();
  const decides = new Set<string>();
  const steps: string[] = [];
  let usesRaw = false;

  const opaque: string[] = [];
  const userIdRoots: AstNode[] = [options.doNode];
  const intrinsics: Array<{
    name: "liveQuery" | "applySearchEmbedCdc";
    call: CallExpression;
  }> = [];
  const chains = collectFxChains(options, opaque, userIdRoots, intrinsics);

  for (const { call, chain } of chains) {
    if (chain.rootMethod === "raw") {
      usesRaw = true;
      continue;
    }

    if (chain.rootMethod === "step" && call === chain.rootCall) {
      const name = stringArg(call.arguments[0]);
      if (name !== undefined && !steps.includes(name)) steps.push(name);
      continue;
    }

    if (chain.rootMethod === "emit" && call === chain.rootCall) {
      const ref = resolveNamed(call.arguments[0], options.bindings, "signal");
      if (ref) emits.add(ref);
      continue;
    }

    if (chain.rootMethod === "deadLetters" && call === chain.rootCall) {
      const ref = resolveNamed(call.arguments[0], options.bindings, "signal");
      if (ref) reads.add(`signal:${ref}`);
      continue;
    }

    if (chain.rootMethod === "live" && call === chain.rootCall) {
      const ref = resolveNamed(call.arguments[0], options.bindings, "signal");
      if (ref) reads.add(`signal:${ref}`);
      continue;
    }

    if (chain.rootMethod === "send" && call === chain.rootCall) {
      const ref = resolveNamed(call.arguments[0], options.bindings, "template");
      if (ref) sends.add(ref);
      continue;
    }

    if (chain.rootMethod === "run" && call === chain.rootCall) {
      const binding = resolveBinding(call.arguments[0], options.bindings);
      const name =
        stringArg(call.arguments[0]) ?? (binding?.kind === "agent" ? binding.ref : undefined);
      if (name) asks.add(name);
      if (binding?.kind === "agent") {
        for (const child of binding.agentCalls ?? []) calls.add(child);
      }
      continue;
    }

    if (chain.rootMethod === "ask" && call === chain.rootCall) {
      const ref = resolvePrompt(call.arguments[0], options.bindings);
      if (ref) asks.add(ref);
      // fx.ask(…, { tools: [flowRef, …] }) → effects.calls (same as fx.call)
      const askOpts = call.arguments[2];
      if (askOpts && askOpts.type === "ObjectExpression") {
        for (const toolRef of toolsFromAskOptions(askOpts, options.bindings)) {
          calls.add(toolRef);
        }
      }
      continue;
    }

    if (chain.rootMethod === "embed" && call === chain.rootCall) {
      // fx.embed(model, text) — distinct from fx.ask; never classified as asks.
      // Prefer model binding; also accept embed-pipeline and string literals.
      const lit = stringArg(call.arguments[0]);
      if (lit) {
        embeds.add(lit);
      } else {
        const binding = resolveBinding(call.arguments[0], options.bindings);
        if (binding && (binding.kind === "embed" || binding.kind === "unknown")) {
          embeds.add(binding.ref);
        } else {
          const name = identifierName(call.arguments[0]);
          if (name) embeds.add(name);
        }
      }
      continue;
    }

    if (chain.rootMethod === "decide" && call === chain.rootCall) {
      const binding = resolveBinding(call.arguments[0], options.bindings);
      const name =
        stringArg(call.arguments[0]) ?? (binding?.kind === "decision" ? binding.ref : undefined);
      if (name) decides.add(name);
      continue;
    }

    if (chain.rootMethod === "fetch" && call === chain.rootCall) {
      // fx.fetch(url) — host becomes effects.fetches entry.
      const lit = stringArg(call.arguments[0]);
      if (lit) {
        const host = hostFromUrlLiteral(lit);
        if (host) fetches.add(host);
      }
      continue;
    }

    if (chain.rootMethod === "vault" && call === chain.rootCall) {
      // `fx.vault.list()` / `fx.vault.status()` take no path — nothing to
      // declare. Every other method's first argument is the secret.
      const method = chain.methods[1] ?? "get";
      if (!VAULT_PATH_METHODS.has(method)) continue;
      const ref = resolveNamed(call.arguments[0], options.bindings, "secret");
      if (ref) secrets.add(ref);
      continue;
    }

    if (chain.rootMethod === "call" && call === chain.rootCall) {
      const ref = resolveCallTarget(call.arguments[0], options.bindings);
      if (ref) calls.add(ref);
      continue;
    }

    if (chain.rootMethod === "auth" && call === chain.rootCall) {
      const method = chain.methods[1];
      if (method === "listApiKeys") reads.add("auth:api-keys");
      if (method === "listTenants" || method === "listMembers") reads.add("auth:tenants");
      if (
        method === "createApiKey" ||
        method === "revokeApiKey" ||
        method === "rotateApiKey" ||
        method === "updateApiKey"
      ) {
        writes.add("auth:api-keys");
      }
      if (
        method === "switchTenant" ||
        method === "createTenant" ||
        method === "deleteTenant" ||
        method === "addMember" ||
        method === "removeMember" ||
        method === "upsertTenantRole"
      ) {
        writes.add("auth:tenants");
      }
      continue;
    }

    if (chain.rootMethod === "search" && call === chain.rootCall) {
      const ref = resolveNamed(call.arguments[0], options.bindings, "embed");
      if (ref) {
        reads.add((ref.includes(":") ? ref : `index:${ref}`) as ResourceRef);
      }
      continue;
    }

    if (chain.rootMethod === "store") {
      const resolved = storeResourceFromCall(call, options.bindings, chain);
      if (!resolved) continue;
      const op = classifyStoreMethods(resolved.methods);
      if (op === "none") continue;
      // Skip incomplete chains (`select` before `.from`, `insert` before table) —
      // the sibling call that carries the table arg records the real resource.
      const leaf = resolved.methods[resolved.methods.length - 1]!;
      const hasTable = tableFromStoreChain(call, options.bindings, chain) !== undefined;
      if (!hasTable && (leaf === "select" || leaf === "insert" || leaf === "update")) {
        continue;
      }
      // Intermediate chain links that only forward (where/values/returning)
      // still carry read/write from earlier methods — record once we have a table
      // or a terminal key-based op.
      if (!hasTable && (leaf === "where" || leaf === "values" || leaf === "returning")) {
        continue;
      }
      if (op === "read" || op === "both") reads.add(resolved.resource);
      if (op === "write" || op === "both") writes.add(resolved.resource);
    }
  }

  for (const item of intrinsics) {
    noteIntrinsic(item.name, item.call, options.bindings, reads, writes, embeds, (detail) => {
      opaque.push(detail);
    });
  }

  if (opaque.length > 0 && !options.hasExplicitEffects) {
    const flow = options.flowName ?? "flow";
    const detail = opaque[0] ?? "hides fx from effect inference";
    throw new Error(
      `OKE1900: flow "${flow}" ${detail}. Name the parameter fx and keep chain aliases in the same function, or declare effects that include every effect inference can see.`,
    );
  }

  const effects: Effects = {};
  if (reads.size > 0) effects.reads = sortUnique([...reads]);
  if (writes.size > 0) effects.writes = sortUnique([...writes]);
  if (emits.size > 0) effects.emits = sortUnique([...emits]);
  if (sends.size > 0) effects.sends = sortUnique([...sends]);
  if (asks.size > 0) effects.asks = sortUnique([...asks]);
  if (embeds.size > 0) effects.embeds = sortUnique([...embeds]);
  if (secrets.size > 0) effects.secrets = sortUnique([...secrets]);
  if (calls.size > 0) effects.calls = sortUnique([...calls]);
  if (fetches.size > 0) effects.fetches = sortUnique([...fetches]);
  if (decides.size > 0) effects.decides = sortUnique([...decides]);

  return {
    effects,
    steps,
    usesRaw,
    cacheIneligible: usesRaw && !options.hasExplicitEffects,
    nondeterministic: asks.size > 0 || embeds.size > 0 || decides.size > 0,
    readsUserId: userIdRoots.some((node) => containsAuthUserId(node)),
  };
}

const EFFECT_KEYS = [
  "reads",
  "writes",
  "emits",
  "sends",
  "asks",
  "embeds",
  "secrets",
  "calls",
  "fetches",
  "decides",
] as const satisfies readonly (keyof Effects)[];

/**
 * Keys in `inferred` that `declared` does not include.
 *
 * An explicit `effects` object is a floor: it may add keys inference
 * cannot see, and it must include every key the walk can see.
 *
 * @param declared - Author-declared effects
 * @param inferred - Effects the walk can see
 */
export function effectsMissingFromDeclaration(declared: Effects, inferred: Effects): string[] {
  const missing: string[] = [];
  for (const key of EFFECT_KEYS) {
    const have = new Set<string>(declared[key] ?? []);
    for (const item of inferred[key] ?? []) {
      if (!have.has(item)) missing.push(`${key} ${item}`);
    }
  }
  return missing;
}

/**
 * Walk an AST and collect every CallExpression.
 *
 * @param root - Root node
 */
export function collectCallExpressions(root: AstNode): CallExpression[] {
  const out: CallExpression[] = [];
  walk(root, (node) => {
    if (node.type === "CallExpression") out.push(node as CallExpression);
  });
  return out;
}

/**
 * Generic AST walk.
 *
 * @param node - Current node
 * @param visit - Visitor
 */
export function walk(node: unknown, visit: (node: AstNode) => void): void {
  if (node === null || typeof node !== "object") return;
  const n = node as AstNode;
  if (typeof n.type === "string") visit(n);
  for (const value of Object.values(n)) {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visit);
    } else if (value !== null && typeof value === "object") {
      walk(value, visit);
    }
  }
}

interface FxChain {
  rootMethod: string;
  methods: string[];
  rootCall: CallExpression;
  /** Outermost call of an alias init, when the continuation is a later statement. */
  aliasLeaf?: CallExpression;
}

/**
 * If `call` is part of an `fx.method…` chain, return the root method and
 * the full method path from root to this call.
 *
 * @param call - Call expression
 */
export function fxMemberChain(call: CallExpression): FxChain | null {
  let current: CallExpression | null = call;
  const methods: string[] = [];
  let rootCall: CallExpression | null = null;
  let rootMethod: string | null = null;

  while (current) {
    const callee = current.callee;
    if (callee.type !== "MemberExpression") return null;
    const member = callee as AstNode & {
      object: AstNode;
      property: AstNode;
      computed?: boolean;
    };
    if (member.computed) return null;
    if (member.property.type !== "Identifier") return null;
    const prop = (member.property as Identifier).name;
    methods.unshift(prop);

    if (member.object.type === "Identifier" && (member.object as Identifier).name === "fx") {
      rootCall = current;
      rootMethod = prop;
      break;
    }

    if (member.object.type === "CallExpression") {
      current = member.object as CallExpression;
      continue;
    }

    if (member.object.type === "MemberExpression") {
      const inner = member.object as AstNode & {
        object: AstNode;
        property: AstNode;
      };
      if (
        inner.object.type === "Identifier" &&
        (inner.object as Identifier).name === "fx" &&
        inner.property.type === "Identifier"
      ) {
        rootCall = current;
        rootMethod = (inner.property as Identifier).name;
        methods.unshift(rootMethod);
        break;
      }
    }

    return null;
  }

  if (!rootCall || !rootMethod) return null;
  return { rootMethod, methods, rootCall };
}

/**
 * Resolve the store resource for a call that is `fx.store(…).method(table?)`.
 *
 * @param call - Any call in an fx.store chain
 * @param bindings - Scope bindings
 */
export function storeResourceFromCall(
  call: CallExpression,
  bindings: ReadonlyMap<string, InferBinding>,
  known?: FxChain,
): { resource: ResourceRef; methods: string[] } | undefined {
  const chain = known ?? fxMemberChain(call);
  if (!chain || chain.rootMethod !== "store") return undefined;

  const storeArg = chain.rootCall.arguments[0];
  const storeBinding = resolveBinding(storeArg, bindings);
  const facet = storeBinding?.facet ?? "sql";

  const table = tableFromStoreChain(call, bindings, chain);

  if (table) {
    return {
      // sql:<table> is the shared naming convention with the kernel's
      // runtime capability gate (see ../manifest/sql-resource.ts) — table
      // args only ever occur on sql-facet methods in practice.
      resource: (facet === "sql" ? sqlTableRef(table) : `${facet}:${table}`) as ResourceRef,
      methods: chain.methods,
    };
  }

  if (storeBinding?.kind === "store") {
    return { resource: storeBinding.ref as ResourceRef, methods: chain.methods };
  }

  const literal = stringArg(storeArg);
  if (literal) {
    return {
      resource: (literal.includes(":") ? literal : `${facet}:${literal}`) as ResourceRef,
      methods: chain.methods,
    };
  }

  const id = identifierName(storeArg);
  if (id) {
    return { resource: `${facet}:${id}` as ResourceRef, methods: chain.methods };
  }

  return undefined;
}

/**
 * Walk an `fx.store(…).a().b(table)` chain and return the declared table
 * name — resolved through a registered `table` binding (the real string
 * passed to `store.schema.table(name, …)`) when the argument is one, so a
 * JS binding named differently from its declared table (`const notesTable
 * = store.schema.table("notes", …)`) still resolves to `"notes"`, matching
 * what the kernel reads off the live table object at call time. Falls back
 * to the raw identifier text otherwise.
 *
 * @param call - Any call in the chain
 * @param bindings - Scope bindings
 */
function tableFromStoreChain(
  call: CallExpression,
  bindings: ReadonlyMap<string, InferBinding>,
  chain?: FxChain,
): string | undefined {
  const found = tableFromStoreWalk(call, bindings, chain);
  if (found) return found;
  if (chain?.aliasLeaf && chain.aliasLeaf !== call) {
    return tableFromStoreWalk(chain.aliasLeaf, bindings);
  }
  return undefined;
}

function tableFromStoreWalk(
  call: CallExpression,
  bindings: ReadonlyMap<string, InferBinding>,
  chain?: FxChain,
): string | undefined {
  let current: AstNode | undefined = call;
  const seen = new Set<AstNode>();
  while (current && current.type === "CallExpression" && !seen.has(current)) {
    seen.add(current);
    const c = current as CallExpression;
    const link = chain ? undefined : fxMemberChain(c);
    if (!chain && (!link || link.rootMethod !== "store")) break;
    const leaf = chain ? methodNameOfCall(c) : link?.methods[link.methods.length - 1];
    if (!leaf) break;
    if (TABLE_ARG_METHODS.has(leaf)) {
      // KV / files / index take a key, not a table. Treating `delete(key)` as
      // `delete(table)` stamps `kv:key` instead of `kv:drafts` and the runtime
      // then throws OKE1002 on the real namespace.
      const storeArg = chain?.rootCall.arguments[0] ?? link?.rootCall.arguments[0];
      const storeBinding = resolveBinding(storeArg, bindings);
      if (storeBinding?.facet !== undefined && storeBinding.facet !== "sql") {
        // keep walking — no table on this link
      } else {
        const id = identifierName(c.arguments[0]);
        if (id) {
          const binding = bindings.get(id);
          return binding?.kind === "table" ? binding.ref : id;
        }
      }
    }
    const callee = c.callee;
    if (callee.type === "MemberExpression") {
      const obj = (callee as AstNode & { object: AstNode }).object;
      if (obj.type === "CallExpression") {
        current = obj;
        continue;
      }
    }
    break;
  }
  return undefined;
}

function methodNameOfCall(call: CallExpression): string | undefined {
  const callee = call.callee;
  if (callee.type !== "MemberExpression") return undefined;
  const property = (callee as AstNode & { property?: AstNode }).property;
  return identifierName(property);
}

function classifyStoreMethods(methods: string[]): "read" | "write" | "both" | "none" {
  const ops = methods.slice(1);
  let read = false;
  let write = false;
  for (const m of ops) {
    if (READ_METHODS.has(m)) read = true;
    if (WRITE_METHODS.has(m)) write = true;
  }
  if (!read && !write) return "none";
  if (read && write) return "both";
  return read ? "read" : "write";
}

function sortUnique<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort();
}

function resolveBinding(
  node: AstNode | undefined,
  bindings: ReadonlyMap<string, InferBinding>,
): InferBinding | undefined {
  const name = identifierName(node);
  if (!name) return undefined;
  return bindings.get(name);
}

function resolveNamed(
  node: AstNode | undefined,
  bindings: ReadonlyMap<string, InferBinding>,
  kind: InferBinding["kind"],
): string | undefined {
  const lit = stringArg(node);
  if (lit) return lit;
  const binding = resolveBinding(node, bindings);
  if (binding && (binding.kind === kind || binding.kind === "unknown")) {
    return binding.ref;
  }
  return identifierName(node);
}

function resolvePrompt(
  node: AstNode | undefined,
  bindings: ReadonlyMap<string, InferBinding>,
): PromptRef | undefined {
  const lit = stringArg(node);
  if (lit) return lit;
  const binding = resolveBinding(node, bindings);
  if (binding?.kind === "prompt") {
    if (binding.version !== undefined) {
      return `${binding.ref}@${binding.version}`;
    }
    return binding.ref;
  }
  return identifierName(node);
}

/**
 * Resolve `tools: […]` from an `fx.ask` options object literal.
 *
 * @param opts - ObjectExpression
 * @param bindings - Known bindings
 */
function toolsFromAskOptions(
  opts: AstNode,
  bindings: ReadonlyMap<string, InferBinding>,
): FlowRef[] {
  const props = ((opts as AstNode & { properties?: AstNode[] }).properties ?? []).filter(
    (p) => p.type === "Property" || p.type === "ObjectProperty",
  );
  let toolsNode: AstNode | undefined;
  for (const prop of props) {
    const keyNode = (prop as AstNode & { key?: AstNode }).key;
    const key =
      keyNode?.type === "Identifier"
        ? (keyNode as Identifier).name
        : keyNode?.type === "Literal" && typeof (keyNode as Literal).value === "string"
          ? ((keyNode as Literal).value as string)
          : undefined;
    if (key === "tools") {
      toolsNode = (prop as AstNode & { value?: AstNode }).value;
      break;
    }
  }
  if (!toolsNode || toolsNode.type !== "ArrayExpression") return [];
  const els = ((toolsNode as AstNode & { elements?: AstNode[] }).elements ?? []).filter(
    (el): el is AstNode => el !== null && el !== undefined,
  );
  const out: FlowRef[] = [];
  for (const el of els) {
    const ref = resolveCallTarget(el, bindings);
    if (ref) out.push(ref as FlowRef);
  }
  return out;
}

/**
 * Resolve `fx.call` / ask-tools: flow name, `mcp:` ref, or `server.tool("x")`.
 *
 * @param node - Argument AST
 * @param bindings - Known bindings
 */
export function resolveCallTarget(
  node: AstNode | undefined,
  bindings: ReadonlyMap<string, InferBinding>,
): string | undefined {
  const mcp = resolveMcpToolExpr(node, bindings);
  if (mcp) return mcp;
  return resolveNamed(node, bindings, "flow");
}

/**
 * Resolve `server.tool("name")` or a bound `mcp-tool` identifier.
 *
 * @param node - AST
 * @param bindings - Known bindings
 */
export function resolveMcpToolExpr(
  node: AstNode | undefined,
  bindings: ReadonlyMap<string, InferBinding>,
): string | undefined {
  if (!node) return undefined;
  if (node.type === "CallExpression") {
    const callee = (node as CallExpression).callee;
    if (callee.type === "MemberExpression") {
      const member = callee as AstNode & { object: AstNode; property: AstNode };
      const obj = identifierName(member.object);
      const prop = identifierName(member.property);
      const tool = stringArg((node as CallExpression).arguments[0]);
      if (obj && prop === "tool" && tool) {
        const server = bindings.get(obj);
        if (server?.kind === "mcp-server") {
          return `mcp:${server.ref}/${tool}`;
        }
      }
    }
  }
  const binding = resolveBinding(node, bindings);
  if (binding?.kind === "mcp-tool") return binding.ref;
  return undefined;
}

/**
 * String literal argument.
 *
 * @param node - AST node
 */
export function stringArg(node: AstNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "Literal" && typeof (node as Literal).value === "string") {
    return (node as Literal).value as string;
  }
  if (node.type === "TemplateLiteral") {
    const quasis = (node as AstNode & { quasis?: AstNode[] }).quasis;
    const exprs = (node as AstNode & { expressions?: AstNode[] }).expressions;
    if (quasis?.length === 1 && (exprs?.length ?? 0) === 0) {
      const cooked = (quasis[0] as AstNode & { value?: { cooked?: string } }).value?.cooked;
      if (typeof cooked === "string") return cooked;
    }
  }
  return undefined;
}

/**
 * Hostname from a URL string literal for `fx.fetch` inference.
 *
 * @param url - Absolute or protocol-relative URL string
 */
export function hostFromUrlLiteral(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.hostname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Identifier name.
 *
 * @param node - AST node
 */
export function identifierName(node: AstNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "Identifier") return (node as Identifier).name;
  return undefined;
}

function containsAuthUserId(root: AstNode): boolean {
  let found = false;
  walk(root, (node) => {
    if (found) return;
    if (node.type !== "MemberExpression") return;
    const member = node as AstNode & {
      object: AstNode;
      property: AstNode;
      computed?: boolean;
    };
    if (member.computed) return;
    if (member.property.type !== "Identifier") return;
    if ((member.property as Identifier).name !== "userId") return;
    if (member.object.type !== "MemberExpression") return;
    const auth = member.object as AstNode & {
      object: AstNode;
      property: AstNode;
    };
    if (auth.property.type !== "Identifier") return;
    if ((auth.property as Identifier).name !== "auth") return;
    if (auth.object.type === "Identifier" && (auth.object as Identifier).name === "fx") {
      found = true;
    }
  });
  return found;
}

interface ChainAlias {
  readonly methods: readonly string[];
  readonly rootMethod: string;
  readonly rootCall: CallExpression;
  readonly leafCall: CallExpression;
}

interface ChainHit {
  readonly call: CallExpression;
  readonly chain: FxChain;
}

const VALUE_WRAPPERS = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSTypeAssertion",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "AwaitExpression",
]);

function collectFxChains(
  options: InferEffectsOptions,
  opaque: string[],
  userIdRoots: AstNode[],
  intrinsics: Array<{ name: "liveQuery" | "applySearchEmbedCdc"; call: CallExpression }>,
): ChainHit[] {
  const hits: ChainHit[] = [];
  const seen = new Set<AstNode>();

  const follow = (
    fn: AstNode,
    file: string,
    aliases: ReadonlyMap<string, ChainAlias>,
    locals: ReadonlyMap<string, AstNode>,
  ): void => {
    analyzeFunction(fn, "fx", aliases, locals, file);
  };

  const analyzeFunction = (
    fn: AstNode,
    door: string,
    outerAliases: ReadonlyMap<string, ChainAlias>,
    outerLocals: ReadonlyMap<string, AstNode>,
    file: string,
  ): void => {
    if (seen.has(fn)) return;
    seen.add(fn);
    userIdRoots.push(fn);
    const body = (fn as AstNode & { body?: AstNode }).body;
    if (!body) return;
    analyzeBody(body, door, outerAliases, outerLocals, file);
  };

  const analyzeBody = (
    body: AstNode,
    door: string,
    outerAliases: ReadonlyMap<string, ChainAlias>,
    outerLocals: ReadonlyMap<string, AstNode>,
    file: string,
  ): void => {
    const aliases = new Map(outerAliases);
    const locals = new Map(outerLocals);
    collectDirect(body, aliases, locals);
    checkEscapes(body, door, new Set(aliases.keys()), (detail) => {
      opaque.push(detail);
    });
    for (const call of callsSkippingNested(body)) {
      const chain = chainFromCall(call, aliases);
      if (chain) {
        hits.push({ call, chain });
        continue;
      }
      noteFxPass(call, door, aliases, locals, file, opaque, intrinsics, follow);
    }
    for (const nested of nestedFunctions(body)) {
      if (seen.has(nested)) continue;
      const shadows = functionParams(nested).some((param) => paramIdentifierName(param) === door);
      if (shadows) continue;
      analyzeFunction(nested, door, aliases, locals, file);
    }
  };

  const startFile = options.file ?? "";
  if (isFunctionNode(options.doNode)) {
    const params = functionParams(options.doNode);
    const second = params.length >= 2 ? params[1] : undefined;
    if (second && paramIdentifierName(second) !== "fx") {
      opaque.push("the do callback's second parameter is not named fx");
    }
    analyzeFunction(options.doNode, "fx", new Map(), new Map(), startFile);
  } else {
    analyzeBody(options.doNode, "fx", new Map(), new Map(), startFile);
  }

  return hits;

  function noteFxPass(
    call: CallExpression,
    door: string,
    aliases: ReadonlyMap<string, ChainAlias>,
    locals: ReadonlyMap<string, AstNode>,
    file: string,
    reasons: string[],
    foundIntrinsics: Array<{ name: "liveQuery" | "applySearchEmbedCdc"; call: CallExpression }>,
    enter: (
      fn: AstNode,
      file: string,
      aliases: ReadonlyMap<string, ChainAlias>,
      locals: ReadonlyMap<string, AstNode>,
    ) => void,
  ): void {
    const args = call.arguments ?? [];
    for (let index = 0; index < args.length; index++) {
      const arg = unwrapValue(args[index]);
      if (!arg || arg.type !== "Identifier") continue;
      const name = identifierName(arg);
      if (!name) continue;
      if (aliases.has(name)) {
        reasons.push(`passes chain alias "${name}" to a call`);
        continue;
      }
      if (name !== door) continue;
      const resolved = resolveCallee(call.callee, locals, options, file);
      if (resolved.kind === "function") {
        const param = functionParams(resolved.fn)[index];
        if (!param || paramIdentifierName(param) !== "fx") {
          reasons.push("passes fx to a parameter that is not named fx");
          continue;
        }
        const local = calleeLocal(call.callee, locals);
        enter(
          resolved.fn,
          resolved.file ?? file,
          local ? aliases : new Map(),
          local ? locals : new Map(),
        );
        continue;
      }
      if (resolved.kind === "intrinsic") {
        if (index !== 0) {
          reasons.push(`passes fx to ${resolved.name} in a position inference cannot read`);
          continue;
        }
        foundIntrinsics.push({ name: resolved.name, call });
        continue;
      }
      reasons.push(`passes fx to "${resolved.label}", which inference cannot resolve`);
    }
  }
}

function calleeLocal(callee: AstNode, locals: ReadonlyMap<string, AstNode>): boolean {
  if (callee.type !== "Identifier") return false;
  const name = identifierName(callee);
  return name !== undefined && locals.has(name);
}

function resolveCallee(
  callee: AstNode,
  locals: ReadonlyMap<string, AstNode>,
  options: InferEffectsOptions,
  file: string,
): FxCalleeResolution {
  if (callee.type === "Identifier") {
    const name = identifierName(callee);
    const local = name ? locals.get(name) : undefined;
    if (local) return { kind: "function", fn: local, file };
  }
  if (options.resolveCallee) return options.resolveCallee(callee, file);
  const label = identifierName(callee) ?? "callee";
  return { kind: "unresolved", label };
}

function noteIntrinsic(
  name: "liveQuery" | "applySearchEmbedCdc",
  call: CallExpression,
  bindings: ReadonlyMap<string, InferBinding>,
  reads: Set<ResourceRef | SignalResourceRef | AuthApiKeysResourceRef | AuthTenantsResourceRef>,
  writes: Set<ResourceRef | AuthApiKeysResourceRef | AuthTenantsResourceRef>,
  embeds: Set<EmbedRef>,
  opaque: (detail: string) => void,
): void {
  if (name === "liveQuery") {
    const ref = sqlRefFromArg(call.arguments[1], bindings);
    if (!ref) {
      opaque("calls liveQuery with a table inference cannot resolve");
      return;
    }
    reads.add(ref as ResourceRef);
    return;
  }
  const sqlRef = stringArg(unwrapValueNode(call.arguments[5]));
  if (!sqlRef) {
    opaque("calls applySearchEmbedCdc with a sqlRef inference cannot resolve");
    return;
  }
  const ref = (sqlRef.includes(":") ? sqlRef : `sql:${sqlRef}`) as ResourceRef;
  reads.add(ref);
  writes.add(ref);
  const models = embedModelsFromColumns(call.arguments[3]);
  if (!models) {
    opaque("calls applySearchEmbedCdc with embed columns inference cannot resolve");
    return;
  }
  for (const model of models) embeds.add(model);
}

function sqlRefFromArg(
  arg: AstNode | undefined,
  bindings: ReadonlyMap<string, InferBinding>,
): string | undefined {
  if (!arg) return undefined;
  const node = unwrapValue(arg);
  const lit = stringArg(node);
  if (lit) return lit.includes(":") ? lit : `sql:${lit}`;
  const binding = resolveBinding(node, bindings);
  if (binding?.kind === "table") return sqlTableRef(binding.ref);
  if (binding?.kind === "store") return binding.ref;
  return undefined;
}

function embedModelsFromColumns(arg: AstNode | undefined): string[] | null {
  if (!arg) return null;
  const node = unwrapValue(arg);
  if (!node || node.type !== "ArrayExpression") return null;
  const elements = (node as AstNode & { elements?: readonly (AstNode | null)[] }).elements ?? [];
  const models: string[] = [];
  for (const element of elements) {
    if (!element || element.type !== "ObjectExpression") return null;
    const model = objectStringProp(element, "model");
    if (model === undefined) {
      if (objectHasProp(element, "model")) return null;
      models.push("default");
      continue;
    }
    models.push(model);
  }
  return models;
}

function objectStringProp(obj: AstNode, key: string): string | undefined {
  for (const prop of objectProps(obj)) {
    if (propKeyName(prop) !== key) continue;
    return stringArg(unwrapValue((prop as AstNode & { value?: AstNode }).value));
  }
  return undefined;
}

function objectHasProp(obj: AstNode, key: string): boolean {
  return objectProps(obj).some((prop) => propKeyName(prop) === key);
}

function objectProps(obj: AstNode): AstNode[] {
  return ((obj as AstNode & { properties?: AstNode[] }).properties ?? []).filter(
    (prop) => prop.type === "Property" || prop.type === "ObjectProperty",
  );
}

function propKeyName(prop: AstNode): string | undefined {
  const key = (prop as AstNode & { key?: AstNode }).key;
  return identifierName(key) ?? stringArg(key);
}

function collectDirect(
  body: AstNode,
  aliases: Map<string, ChainAlias>,
  locals: Map<string, AstNode>,
): void {
  walkStatements(body, (node) => {
    if (node.type === "FunctionDeclaration") {
      const name = identifierName((node as AstNode & { id?: AstNode }).id);
      if (name) locals.set(name, node);
      return;
    }
    if (node.type !== "VariableDeclarator") return;
    const name = identifierName((node as AstNode & { id?: AstNode }).id);
    const init = (node as AstNode & { init?: AstNode | null }).init;
    if (!name || !init) return;
    const value = unwrapValue(init);
    if (value && isFunctionNode(value)) {
      locals.set(name, value);
      return;
    }
    const alias = aliasFromInit(init, aliases);
    if (alias) aliases.set(name, alias);
  });
}

function aliasFromInit(init: AstNode, aliases: ReadonlyMap<string, ChainAlias>): ChainAlias | null {
  const node = unwrapValue(init);
  if (!node || node.type !== "CallExpression") return null;
  const chain = chainFromCall(node as CallExpression, aliases);
  if (!chain || chain.rootMethod !== "store") return null;
  // `const rows = await fx.store(db).select().from(table)` is the query
  // result. `const q = await fx.store(db)` is still the handle.
  if (expressionIsAwaited(init) && !isStoreHandle(chain)) return null;
  return {
    methods: chain.methods,
    rootMethod: chain.rootMethod,
    rootCall: chain.rootCall,
    leafCall: chain.aliasLeaf ?? (node as CallExpression),
  };
}

function isStoreHandle(chain: FxChain): boolean {
  return chain.rootMethod === "store" && classifyStoreMethods(chain.methods) === "none";
}

function expressionIsAwaited(node: AstNode): boolean {
  let current: AstNode | undefined = node;
  for (let i = 0; i < 8 && current; i++) {
    if (current.type === "AwaitExpression") return true;
    if (!VALUE_WRAPPERS.has(current.type)) return false;
    current =
      (current as AstNode & { expression?: AstNode }).expression ??
      (current as AstNode & { argument?: AstNode }).argument;
  }
  return false;
}

function chainFromCall(
  call: CallExpression,
  aliases: ReadonlyMap<string, ChainAlias>,
): FxChain | null {
  const direct = fxMemberChain(call);
  if (direct) return direct;

  let current: CallExpression | null = call;
  const methods: string[] = [];
  while (current) {
    const callee = current.callee;
    if (callee.type !== "MemberExpression") return null;
    const member = callee as AstNode & {
      object: AstNode;
      property: AstNode;
      computed?: boolean;
    };
    if (member.computed === true || member.property.type !== "Identifier") return null;
    methods.unshift((member.property as Identifier).name);
    if (member.object.type === "Identifier") {
      const alias = aliases.get((member.object as Identifier).name);
      if (!alias) return null;
      return {
        rootMethod: alias.rootMethod,
        methods: [...alias.methods, ...methods],
        rootCall: alias.rootCall,
        aliasLeaf: alias.leafCall,
      };
    }
    if (member.object.type === "CallExpression") {
      current = member.object as CallExpression;
      continue;
    }
    return null;
  }
  return null;
}

function checkEscapes(
  root: AstNode,
  door: string,
  aliasNames: ReadonlySet<string>,
  report: (detail: string) => void,
): void {
  const rec = (node: AstNode, parent: AstNode | undefined, inCallArg: boolean): void => {
    if (node !== root && isFunctionNode(node)) return;
    if (node.type === "Identifier") {
      const name = (node as Identifier).name;
      const isAlias = aliasNames.has(name);
      const isDoor = name === door;
      if (
        (isAlias || isDoor) &&
        !isTypePosition(parent) &&
        !(isDoor && inCallArg) &&
        !isAllowedFxUse(node, parent)
      ) {
        report(describeFxEscape(name, parent, isAlias));
      }
    }
    if (node.type === "CallExpression") {
      const call = node as CallExpression;
      rec(call.callee, node, false);
      for (const arg of call.arguments ?? []) {
        if (arg) rec(arg, node, true);
      }
      return;
    }
    if (VALUE_WRAPPERS.has(node.type) && inCallArg) {
      const inner =
        (node as AstNode & { expression?: AstNode }).expression ??
        (node as AstNode & { argument?: AstNode }).argument;
      if (inner) rec(inner, node, true);
      return;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isAstNode(item)) rec(item, node, inCallArg);
        }
      } else if (isAstNode(value)) {
        rec(value, node, inCallArg);
      }
    }
  };
  rec(root, undefined, false);
}

function isAllowedFxUse(node: AstNode, parent: AstNode | undefined): boolean {
  if (!parent) return false;
  if (parent.type === "MemberExpression") {
    const member = parent as AstNode & { object?: AstNode; property?: AstNode; computed?: boolean };
    if (member.property === node && member.computed !== true) return true;
    if (member.object === node) return true;
  }
  if (parent.type === "VariableDeclarator" && (parent as AstNode & { id?: AstNode }).id === node) {
    return true;
  }
  if (
    (parent.type === "FunctionDeclaration" ||
      parent.type === "FunctionExpression" ||
      parent.type === "ArrowFunctionExpression") &&
    (parent as AstNode & { id?: AstNode }).id === node
  ) {
    return true;
  }
  return false;
}

function describeFxEscape(name: string, parent: AstNode | undefined, isAlias: boolean): string {
  if (isAlias) {
    if (parent?.type === "ReturnStatement") return `returns chain alias "${name}"`;
    if (parent?.type === "CallExpression") return `passes chain alias "${name}" to a call`;
    if (
      parent?.type === "ArrayExpression" ||
      parent?.type === "ObjectExpression" ||
      parent?.type === "Property" ||
      parent?.type === "ObjectProperty"
    ) {
      return `puts chain alias "${name}" in an object or array`;
    }
    if (parent?.type === "AssignmentExpression") return `reassigns chain alias "${name}"`;
    return `lets chain alias "${name}" escape`;
  }
  if (parent?.type === "VariableDeclarator") return "aliases fx";
  if (
    parent?.type === "ObjectPattern" ||
    parent?.type === "ArrayPattern" ||
    parent?.type === "Property" ||
    parent?.type === "ObjectProperty" ||
    parent?.type === "RestElement"
  ) {
    return "destructures fx";
  }
  return "lets fx escape";
}

function isTypePosition(parent: AstNode | undefined): boolean {
  if (!parent) return false;
  if (!parent.type.startsWith("TS")) return false;
  return !VALUE_WRAPPERS.has(parent.type);
}

function callsSkippingNested(body: AstNode): CallExpression[] {
  const out: CallExpression[] = [];
  const take = (node: AstNode): void => {
    if (node.type === "CallExpression") out.push(node as CallExpression);
  };
  take(body);
  walkSkipFunctions(body, take);
  return out;
}

function nestedFunctions(body: AstNode): AstNode[] {
  const out: AstNode[] = [];
  walkSkipFunctions(body, (node) => {
    if (isFunctionNode(node)) out.push(node);
  });
  return out;
}

function walkSkipFunctions(root: AstNode, visit: (node: AstNode) => void): void {
  const rec = (node: AstNode): void => {
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (!isAstNode(item)) continue;
          visit(item);
          if (!isFunctionNode(item)) rec(item);
        }
      } else if (isAstNode(value)) {
        visit(value);
        if (!isFunctionNode(value)) rec(value);
      }
    }
  };
  rec(root);
}

function walkStatements(node: AstNode, visit: (node: AstNode) => void): void {
  if (node.type === "BlockStatement" || node.type === "Program" || node.type === "StaticBlock") {
    const body = (node as AstNode & { body?: AstNode[] }).body ?? [];
    for (const stmt of body) walkStatement(stmt, visit);
    return;
  }
  walkSkipFunctions(node, (child) => {
    if (child.type === "VariableDeclarator" || child.type === "FunctionDeclaration") visit(child);
  });
}

function walkStatement(stmt: AstNode, visit: (node: AstNode) => void): void {
  if (stmt.type === "FunctionDeclaration") {
    visit(stmt);
    return;
  }
  if (stmt.type === "VariableDeclaration") {
    const declarations = (stmt as AstNode & { declarations?: AstNode[] }).declarations ?? [];
    for (const decl of declarations) visit(decl);
    return;
  }
  if (stmt.type === "BlockStatement") {
    walkStatements(stmt, visit);
    return;
  }
  if (
    stmt.type === "IfStatement" ||
    stmt.type === "ForStatement" ||
    stmt.type === "ForInStatement" ||
    stmt.type === "ForOfStatement" ||
    stmt.type === "WhileStatement" ||
    stmt.type === "DoWhileStatement" ||
    stmt.type === "LabeledStatement"
  ) {
    const consequent = (stmt as AstNode & { consequent?: AstNode }).consequent;
    const alternate = (stmt as AstNode & { alternate?: AstNode }).alternate;
    const body = (stmt as AstNode & { body?: AstNode }).body;
    if (consequent) walkStatement(consequent, visit);
    if (alternate) walkStatement(alternate, visit);
    if (body && body !== consequent) walkStatement(body, visit);
    return;
  }
  if (stmt.type === "TryStatement") {
    const block = (stmt as AstNode & { block?: AstNode }).block;
    const handler = (stmt as AstNode & { handler?: AstNode }).handler;
    const finalizer = (stmt as AstNode & { finalizer?: AstNode }).finalizer;
    if (block) walkStatement(block, visit);
    const handlerBody = (handler as (AstNode & { body?: AstNode }) | undefined)?.body;
    if (handlerBody) walkStatement(handlerBody, visit);
    if (finalizer) walkStatement(finalizer, visit);
    return;
  }
  if (stmt.type === "SwitchStatement") {
    const cases = (stmt as AstNode & { cases?: AstNode[] }).cases ?? [];
    for (const item of cases) {
      const consequent = (item as AstNode & { consequent?: AstNode[] }).consequent ?? [];
      for (const child of consequent) walkStatement(child, visit);
    }
  }
}

function functionParams(fn: AstNode): AstNode[] {
  return (fn as AstNode & { params?: AstNode[] }).params ?? [];
}

function paramIdentifierName(param: AstNode): string | undefined {
  if (param.type === "Identifier") return identifierName(param);
  if (param.type === "AssignmentPattern" || param.type === "RestElement") {
    const inner =
      (param as AstNode & { left?: AstNode }).left ??
      (param as AstNode & { argument?: AstNode }).argument;
    return identifierName(inner);
  }
  return undefined;
}

function isFunctionNode(node: AstNode): boolean {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  );
}

function unwrapValue(node: AstNode | undefined): AstNode | undefined {
  if (!node) return undefined;
  return unwrapValueNode(node);
}

function unwrapValueNode(node: AstNode | undefined): AstNode | undefined {
  if (!node) return undefined;
  let current = node;
  for (let i = 0; i < 8; i++) {
    if (!VALUE_WRAPPERS.has(current.type)) break;
    const next =
      (current as AstNode & { expression?: AstNode }).expression ??
      (current as AstNode & { argument?: AstNode }).argument;
    if (!next) break;
    current = next;
  }
  return current;
}

function isAstNode(value: unknown): value is AstNode {
  return typeof value === "object" && value !== null && typeof (value as AstNode).type === "string";
}
