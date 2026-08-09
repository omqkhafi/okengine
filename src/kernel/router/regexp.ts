/**
 * Compiled RegExp router — O(1) static map, plus per-bucket compiled
 * regular expressions for parametric routes.
 */

import {
  isUnsupportedByRegExp,
  UnsupportedPathError,
  type RouteMatch,
  type Router,
} from "./types.ts";

function escapeRegex(segment: string): string {
  return segment.replace(/[.^$+{}()|[\]\\]/g, "\\$&");
}

interface CompiledDynamic<T> {
  readonly regex: RegExp;
  /** Per-alternative: which capture index holds the wrapper, param names. */
  readonly alts: readonly {
    readonly wrapGroup: number;
    readonly keys: readonly string[];
    readonly value: T;
  }[];
}

interface MethodTable<T> {
  readonly staticMap: Map<string, T>;
  /**
   * Dynamic routes bucketed by the first path segment (or `""` when the
   * first segment is a param). Each bucket compiles to one RegExp.
   */
  buckets: Map<string, CompiledDynamic<T>> | undefined;
  readonly dynamicRoutes: { path: string; value: T }[];
}

function emptyTable<T>(): MethodTable<T> {
  return { staticMap: new Map(), buckets: undefined, dynamicRoutes: [] };
}

/** First segment key used for dynamic bucketing (`""` if param/empty). */
function bucketKey(path: string): string {
  const parts = path.startsWith("/") ? path.split("/").slice(1) : path.split("/");
  const first = parts[0] ?? "";
  if (first.startsWith(":") || first === "*" || first === "") return "";
  return first;
}

function compileDynamic<T>(routes: readonly { path: string; value: T }[]): CompiledDynamic<T> {
  const alts: CompiledDynamic<T>["alts"][number][] = [];
  const parts: string[] = [];
  let group = 1;

  for (const route of routes) {
    if (isUnsupportedByRegExp(route.path)) {
      throw new UnsupportedPathError(route.path);
    }
    const keys: string[] = [];
    const segments = route.path.split("/");
    const body = segments
      .map((seg) => {
        if (seg.startsWith(":") && seg.length > 1) {
          keys.push(seg.slice(1));
          return "([^/]+)";
        }
        return escapeRegex(seg);
      })
      .join("/");

    parts.push(`(${body})`);
    alts.push({ wrapGroup: group, keys, value: route.value });
    group += 1 + keys.length;
  }

  const regex = parts.length === 0 ? /(?!)/ : new RegExp(`^(?:${parts.join("|")})$`);

  return { regex, alts };
}

function matchCompiled<T>(dyn: CompiledDynamic<T>, path: string): RouteMatch<T> | undefined {
  const m = dyn.regex.exec(path);
  if (!m) return undefined;

  for (const alt of dyn.alts) {
    if (m[alt.wrapGroup] === undefined) continue;
    const params: Record<string, string> = {};
    for (let i = 0; i < alt.keys.length; i++) {
      const key = alt.keys[i];
      const captured = m[alt.wrapGroup + 1 + i];
      if (key !== undefined && captured !== undefined) {
        params[key] = captured;
      }
    }
    return { value: alt.value, params };
  }
  return undefined;
}

/**
 * Compiled RegExp router — O(1) static map, plus per-bucket compiled
 * regular expressions for parametric routes.
 */
export class RegExpRouter<T> implements Router<T> {
  readonly name = "RegExpRouter";
  readonly #tables = new Map<string, MethodTable<T>>();
  #built = false;

  /**
   * @param method - HTTP method
   * @param path - Path pattern
   * @param value - Route value
   */
  add(method: string, path: string, value: T): void {
    if (this.#built) {
      throw new Error("RegExpRouter matcher is already built");
    }
    if (isUnsupportedByRegExp(path)) {
      throw new UnsupportedPathError(path);
    }
    let table = this.#tables.get(method);
    if (!table) {
      table = emptyTable();
      this.#tables.set(method, table);
    }
    if (!path.includes("/:")) {
      table.staticMap.set(path, value);
      return;
    }
    table.dynamicRoutes.push({ path, value });
  }

  /**
   * Compile dynamic routes. Idempotent.
   */
  build(): void {
    if (this.#built) return;
    for (const table of this.#tables.values()) {
      if (table.dynamicRoutes.length === 0) continue;
      const grouped = new Map<string, { path: string; value: T }[]>();
      for (const route of table.dynamicRoutes) {
        const key = bucketKey(route.path);
        let list = grouped.get(key);
        if (!list) {
          list = [];
          grouped.set(key, list);
        }
        list.push(route);
      }
      const buckets = new Map<string, CompiledDynamic<T>>();
      for (const [key, routes] of grouped) {
        buckets.set(key, compileDynamic(routes));
      }
      table.buckets = buckets;
    }
    this.#built = true;
  }

  /**
   * @param method - HTTP method
   * @param path - Pathname
   */
  match(method: string, path: string): RouteMatch<T> | undefined {
    this.build();
    const table = this.#tables.get(method);
    if (!table) return undefined;

    const staticHit = table.staticMap.get(path);
    if (staticHit !== undefined) {
      return { value: staticHit, params: {} };
    }

    const buckets = table.buckets;
    if (!buckets) return undefined;

    const key = bucketKey(path);
    const primary = buckets.get(key);
    if (primary) {
      const hit = matchCompiled(primary, path);
      if (hit) return hit;
    }
    // Routes whose first segment is a param live in the `""` bucket.
    if (key !== "") {
      const catchAll = buckets.get("");
      if (catchAll) return matchCompiled(catchAll, path);
    }
    return undefined;
  }
}
