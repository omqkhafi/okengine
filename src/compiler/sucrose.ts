/**
 * Sucrose-style static analysis — which context properties a handler uses.
 *
 * Reads `Function.toString()` and pattern-matches property access /
 * destructuring. Conservative: unknown shapes enable all slots.
 */

import {
  emptyInference,
  FULL_INFERENCE,
  mergeInference,
  pathParamNames,
  type ContextInference,
  type MutableInference,
} from "./http-parse.ts";

/** Context property names sucrose tracks. */
const CONTEXT_KEYS = [
  "body",
  "query",
  "params",
  "headers",
  "cookie",
] as const;

type ContextKey = (typeof CONTEXT_KEYS)[number];

/** Options for {@link sucrose}. */
export interface SucroseOptions {
  /** Primary route handler (`flow.do` or compose wrapper). */
  readonly handler: (...args: never[]) => unknown;
  /** Additional lifecycle functions to analyse. */
  readonly hooks?: ReadonlyArray<(...args: never[]) => unknown>;
  /** HTTP path — enables `params` when `:name` tokens appear. */
  readonly path?: string;
  /** HTTP method — influences default body inference. */
  readonly method?: string;
  /** True when an `in` schema is present. */
  readonly hasSchema?: boolean;
}

/**
 * Analyse handlers and return which request context slots are needed.
 *
 * @param options - Handler / hooks / route metadata
 */
export function sucrose(options: SucroseOptions): ContextInference {
  const inference = emptyInference();

  analyseFunction(options.handler, inference);
  for (const hook of options.hooks ?? []) {
    analyseFunction(hook, inference);
  }

  const pathParams = options.path ? pathParamNames(options.path) : [];
  if (pathParams.length > 0) {
    inference.params = true;
  }

  const method = (options.method ?? "GET").toUpperCase();
  const bodyMethod =
    method !== "GET" && method !== "HEAD" && method !== "DELETE";

  // OKE handlers receive assembled input as arg0 — body methods always
  // parse JSON. AoT still drops query/headers/cookie when unused.
  if (bodyMethod) {
    inference.body = true;
  }

  if (options.hasSchema && !bodyMethod) {
    // GET/HEAD/DELETE with a contract: path params and/or query
    if (!inference.params && !inference.query) {
      inference.query = true;
    }
  }

  return inference;
}

/**
 * Analyse a single function into `inference` (OR-merge).
 *
 * @param fn - Function to inspect
 * @param inference - Accumulator
 */
export function analyseFunction(
  fn: (...args: never[]) => unknown,
  inference: MutableInference,
): void {
  let source: string;
  try {
    source = Function.prototype.toString.call(fn);
  } catch {
    mergeInference(inference, FULL_INFERENCE);
    return;
  }

  if (!source || source.includes("[native code]")) {
    mergeInference(inference, FULL_INFERENCE);
    return;
  }

  const { parameter, body } = splitFunction(source);
  if (parameter === undefined || body === undefined) {
    mergeInference(inference, FULL_INFERENCE);
    return;
  }

  const aliases = collectAliases(parameter, body);

  if (isContextPassedToFunction(aliases, body)) {
    mergeInference(inference, FULL_INFERENCE);
    return;
  }

  for (const alias of aliases) {
    inferFromAlias(alias, body, inference);
  }

  // Destructuring in the parameter list: ({ body, query, id })
  inferFromDestructure(parameter, inference);
}

function splitFunction(
  source: string,
): { parameter: string | undefined; body: string | undefined } {
  // async (a, b) => … | (a) => … | function (a, b) { … }
  const arrow = source.match(
    /^(?:async\s*)?(?:\(([^)]*)\)|([a-zA-Z_$][\w$]*))\s*=>\s*([\s\S]*)$/,
  );
  if (arrow) {
    return {
      parameter: (arrow[1] ?? arrow[2] ?? "").trim(),
      body: arrow[3] ?? "",
    };
  }
  const classic = source.match(
    /^(?:async\s*)?function\s*(?:[a-zA-Z_$][\w$]*)?\s*\(([^)]*)\)\s*\{([\s\S]*)\}$/,
  );
  if (classic) {
    return {
      parameter: (classic[1] ?? "").trim(),
      body: classic[2] ?? "",
    };
  }
  return { parameter: undefined, body: undefined };
}

function collectAliases(parameter: string, body: string): string[] {
  const aliases: string[] = [];
  // First parameter only (context / input)
  const first = parameter.split(",")[0]?.trim() ?? "";
  if (!first) return aliases;

  if (first.startsWith("{")) {
    // Destructured — no alias; property keys handled separately
    return aliases;
  }

  const name = first.replace(/\s*=\s*[\s\S]*$/, "").trim();
  if (/^[a-zA-Z_$][\w$]*$/.test(name)) {
    aliases.push(name);
  }

  // const x = input / let x = input
  for (const alias of aliases.slice()) {
    const re = new RegExp(
      `\\b(?:const|let|var)\\s+([a-zA-Z_$][\\w$]*)\\s*=\\s*${escapeRegExp(alias)}\\b`,
      "g",
    );
    for (const match of body.matchAll(re)) {
      const next = match[1];
      if (next) aliases.push(next);
    }
  }

  return aliases;
}

function inferFromAlias(
  alias: string,
  body: string,
  inference: MutableInference,
): void {
  for (const key of CONTEXT_KEYS) {
    if (inference[key]) continue;
    const access = new RegExp(
      `${escapeRegExp(alias)}\\s*(?:\\.\\s*${key}|\\[\\s*['"]${key}['"]\\s*\\])`,
    );
    if (access.test(body)) {
      inference[key] = true;
    }
  }
}

function inferFromDestructure(
  parameter: string,
  inference: MutableInference,
): void {
  if (!parameter.includes("{")) return;
  for (const key of CONTEXT_KEYS) {
    const re = new RegExp(`\\b${key}\\b`);
    if (re.test(parameter)) {
      inference[key as ContextKey] = true;
    }
  }
}

function isContextPassedToFunction(
  aliases: readonly string[],
  body: string,
): boolean {
  for (const alias of aliases) {
    if (alias.length === 0) continue;
    // Word-boundary safe: `(…, alias, …)` or `(alias)` as a complete argument
    const re = new RegExp(
      `(?:^|[^\\w$])\\w+\\s*\\([^)]*(?:^|[,(\\s])${escapeRegExp(alias)}(?:[,)\\s])`,
    );
    if (re.test(body)) return true;
    // shorthand: fn(alias)
    const exact = new RegExp(
      `\\(\\s*${escapeRegExp(alias)}\\s*\\)`,
    );
    if (exact.test(body)) return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inference for the dynamic path — always full (no dead-code elimination).
 */
export function dynamicInference(): ContextInference {
  return FULL_INFERENCE;
}
