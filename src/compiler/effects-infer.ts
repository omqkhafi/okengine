/**
 * Effect inference v1 — through the `fx` door only.
 *
 * Deep static analysis is a later optimisation. `fx.raw` requires an
 * explicit `effects` annotation on the flow; unannotated raw access marks
 * the flow cache-ineligible rather than silently guessing.
 */

import type {
  Effects,
  PromptRef,
  ResourceRef,
  SecretRef,
  SignalRef,
  TemplateRef,
  FlowRef,
} from "../manifest/types.ts";

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
    | "prompt"
    | "secret"
    | "template"
    | "flow"
    | "embed"
    | "unknown";
  /** Resolved resource / name. */
  readonly ref: string;
  /** Store facet when kind is `store`. */
  readonly facet?: "sql" | "kv" | "files" | "index";
  /** Prompt version when kind is `prompt`. */
  readonly version?: number;
}

/** Options for {@link inferEffects}. */
export interface InferEffectsOptions {
  /** The `do` handler AST node (function / arrow). */
  readonly doNode: AstNode;
  /** Local name → binding (from the project scope). */
  readonly bindings: ReadonlyMap<string, InferBinding>;
  /**
   * True when the flow options already declare an `effects` object.
   * Required for `fx.raw` to stay cache-eligible.
   */
  readonly hasExplicitEffects: boolean;
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
  /** True when any `fx.ask` was seen (implies nondeterministic). */
  readonly nondeterministic: boolean;
  /** True when the body references `fx.auth.userId`. */
  readonly readsUserId: boolean;
}

const READ_METHODS = new Set([
  "select",
  "get",
  "findById",
  "findByCode",
  "exists",
  "stockOf",
  "getClicks",
  "dailyFor",
  "findMany",
  "findFirst",
  "find",
]);

const WRITE_METHODS = new Set([
  "insert",
  "set",
  "delete",
  "deleteExpired",
  "increment",
  "setStatus",
  "bumpDaily",
  "update",
  "upsert",
  "log",
]);

/** Methods whose first argument is a table / collection identifier. */
const TABLE_ARG_METHODS = new Set([
  "insert",
  "from",
  "findById",
  "findByCode",
  "exists",
  "update",
  "increment",
  "getClicks",
  "stockOf",
  "deleteExpired",
  "bumpDaily",
  "dailyFor",
  "setStatus",
]);

/**
 * Infer effects for a flow `do` body by walking `fx.*` call sites.
 *
 * @param options - Handler AST, bindings, and annotation flag
 */
export function inferEffects(options: InferEffectsOptions): InferredEffects {
  const reads = new Set<ResourceRef>();
  const writes = new Set<ResourceRef>();
  const emits = new Set<SignalRef>();
  const sends = new Set<TemplateRef>();
  const asks = new Set<PromptRef>();
  const secrets = new Set<SecretRef>();
  const calls = new Set<FlowRef>();
  const steps: string[] = [];
  let usesRaw = false;

  for (const call of collectCallExpressions(options.doNode)) {
    const chain = fxMemberChain(call);
    if (!chain) continue;

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

    if (chain.rootMethod === "send" && call === chain.rootCall) {
      const ref = resolveNamed(call.arguments[0], options.bindings, "template");
      if (ref) sends.add(ref);
      continue;
    }

    if (chain.rootMethod === "ask" && call === chain.rootCall) {
      const ref = resolvePrompt(call.arguments[0], options.bindings);
      if (ref) asks.add(ref);
      continue;
    }

    if (chain.rootMethod === "vault" && call === chain.rootCall) {
      const ref = resolveNamed(call.arguments[0], options.bindings, "secret");
      if (ref) secrets.add(ref);
      continue;
    }

    if (chain.rootMethod === "call" && call === chain.rootCall) {
      const ref = resolveNamed(call.arguments[0], options.bindings, "flow");
      if (ref) calls.add(ref);
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
      const resolved = storeResourceFromCall(call, options.bindings);
      if (!resolved) continue;
      const op = classifyStoreMethods(resolved.methods);
      if (op === "none") continue;
      // Skip incomplete chains (`select` before `.from`, `insert` before table) —
      // the sibling call that carries the table arg records the real resource.
      const leaf = resolved.methods[resolved.methods.length - 1]!;
      const hasTable = tableFromStoreChain(call) !== undefined;
      if (
        !hasTable &&
        (leaf === "select" || leaf === "insert" || leaf === "update")
      ) {
        continue;
      }
      // Intermediate chain links that only forward (where/values/returning)
      // still carry read/write from earlier methods — record once we have a table
      // or a terminal key-based op.
      if (
        !hasTable &&
        (leaf === "where" || leaf === "values" || leaf === "returning")
      ) {
        continue;
      }
      if (op === "read" || op === "both") reads.add(resolved.resource);
      if (op === "write" || op === "both") writes.add(resolved.resource);
    }
  }

  const effects: Effects = {};
  if (reads.size > 0) effects.reads = sortUnique([...reads]);
  if (writes.size > 0) effects.writes = sortUnique([...writes]);
  if (emits.size > 0) effects.emits = sortUnique([...emits]);
  if (sends.size > 0) effects.sends = sortUnique([...sends]);
  if (asks.size > 0) effects.asks = sortUnique([...asks]);
  if (secrets.size > 0) effects.secrets = sortUnique([...secrets]);
  if (calls.size > 0) effects.calls = sortUnique([...calls]);

  return {
    effects,
    steps,
    usesRaw,
    cacheIneligible: usesRaw && !options.hasExplicitEffects,
    nondeterministic: asks.size > 0,
    readsUserId: containsAuthUserId(options.doNode),
  };
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

    if (
      member.object.type === "Identifier" &&
      (member.object as Identifier).name === "fx"
    ) {
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
): { resource: ResourceRef; methods: string[] } | undefined {
  const chain = fxMemberChain(call);
  if (!chain || chain.rootMethod !== "store") return undefined;

  const storeArg = chain.rootCall.arguments[0];
  const storeBinding = resolveBinding(storeArg, bindings);
  const facet = storeBinding?.facet ?? "sql";

  const table = tableFromStoreChain(call);

  if (table) {
    return {
      resource: `${facet}:${table}` as ResourceRef,
      methods: chain.methods,
    };
  }

  if (storeBinding?.kind === "store") {
    return { resource: storeBinding.ref as ResourceRef, methods: chain.methods };
  }

  const literal = stringArg(storeArg);
  if (literal) {
    return {
      resource: (literal.includes(":")
        ? literal
        : `${facet}:${literal}`) as ResourceRef,
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
 * Walk an `fx.store(…).a().b(table)` chain and return the table identifier.
 *
 * @param call - Any call in the chain
 */
function tableFromStoreChain(call: CallExpression): string | undefined {
  let current: AstNode | undefined = call;
  while (current && current.type === "CallExpression") {
    const c = current as CallExpression;
    const link = fxMemberChain(c);
    if (!link || link.rootMethod !== "store") break;
    const leaf = link.methods[link.methods.length - 1]!;
    if (TABLE_ARG_METHODS.has(leaf)) {
      const table = identifierName(c.arguments[0]);
      if (table) return table;
    }
    const callee = c.callee;
    if (callee.type === "MemberExpression") {
      current = (callee as AstNode & { object: AstNode }).object;
      continue;
    }
    break;
  }
  return undefined;
}

function classifyStoreMethods(
  methods: string[],
): "read" | "write" | "both" | "none" {
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
      const cooked = (
        quasis[0] as AstNode & { value?: { cooked?: string } }
      ).value?.cooked;
      if (typeof cooked === "string") return cooked;
    }
  }
  return undefined;
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
    if (
      auth.object.type === "Identifier" &&
      (auth.object as Identifier).name === "fx"
    ) {
      found = true;
    }
  });
  return found;
}
