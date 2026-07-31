/**
 * HTTP router — compiled RegExp matching with a Trie fallback, plus a linear
 * preset for cold-start edge builds.
 *
 * Chosen at build/startup: try RegExp first; on unsupported patterns fall
 * back to Trie. The `edge` preset uses LinearRouter for fast registration.
 */

/** Thrown when a router cannot express a path pattern. */
export class UnsupportedPathError extends Error {
  /** Offending path pattern. */
  readonly path: string;

  /**
   * @param path - Offending path pattern
   */
  constructor(path: string) {
    super(`Unsupported path pattern: ${path}`);
    this.name = "UnsupportedPathError";
    this.path = path;
  }
}

/** One match result. */
export interface RouteMatch<T> {
  readonly value: T;
  readonly params: Readonly<Record<string, string>>;
}

/** Router surface shared by all strategies. */
export interface Router<T> {
  readonly name: string;
  /**
   * Register a route.
   *
   * @param method - HTTP method (uppercase)
   * @param path - Path pattern
   * @param value - Payload (usually a flow binding)
   */
  add(method: string, path: string, value: T): void;
  /**
   * Match a method + pathname.
   *
   * @param method - HTTP method
   * @param path - Request pathname
   */
  match(method: string, path: string): RouteMatch<T> | undefined;
}

/** True when the pattern cannot be expressed by the RegExp strategy. */
export function isUnsupportedByRegExp(path: string): boolean {
  // optional params, wildcards, custom regex segments, greedy rests
  return /\/:/.test(path) === false ? /[*?{}()]/.test(path) : /[*?{}]|\/:[^/]+\?/.test(path);
}

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

interface TrieNode<T> {
  staticChildren: Map<string, TrieNode<T>>;
  paramChild?: { name: string; node: TrieNode<T> };
  wildcardChild?: TrieNode<T>;
  value?: T;
}

function newTrieNode<T>(): TrieNode<T> {
  return { staticChildren: new Map() };
}

/**
 * Trie router — supports wildcards and optional-style rests the RegExp
 * path cannot express. Used as SmartRouter fallback.
 */
export class TrieRouter<T> implements Router<T> {
  readonly name = "TrieRouter";
  readonly #roots = new Map<string, TrieNode<T>>();

  /**
   * @param method - HTTP method
   * @param path - Path pattern
   * @param value - Route value
   */
  add(method: string, path: string, value: T): void {
    let root = this.#roots.get(method);
    if (!root) {
      root = newTrieNode();
      this.#roots.set(method, root);
    }
    const parts = path.startsWith("/") ? path.split("/").slice(1) : path.split("/");

    let node = root;
    for (const seg of parts) {
      if (seg === "*") {
        node.wildcardChild ??= newTrieNode();
        node = node.wildcardChild;
        continue;
      }
      if (seg.startsWith(":") && seg.length > 1) {
        const name = seg.endsWith("?") ? seg.slice(1, -1) : seg.slice(1);
        node.paramChild ??= { name, node: newTrieNode() };
        node = node.paramChild.node;
        continue;
      }
      let next = node.staticChildren.get(seg);
      if (!next) {
        next = newTrieNode();
        node.staticChildren.set(seg, next);
      }
      node = next;
    }
    node.value = value;
  }

  /**
   * @param method - HTTP method
   * @param path - Pathname
   */
  match(method: string, path: string): RouteMatch<T> | undefined {
    const root = this.#roots.get(method);
    if (!root) return undefined;
    const parts = path.startsWith("/") ? path.split("/").slice(1) : path.split("/");
    // trailing slash: empty last segment
    if (parts.length > 0 && parts[parts.length - 1] === "") {
      parts.pop();
    }
    const params: Record<string, string> = {};
    const found = this.#walk(root, parts, 0, params);
    if (found === undefined) return undefined;
    return { value: found, params };
  }

  #walk(
    node: TrieNode<T>,
    parts: readonly string[],
    index: number,
    params: Record<string, string>,
  ): T | undefined {
    if (index === parts.length) {
      return node.value;
    }
    const seg = parts[index] ?? "";
    const staticNext = node.staticChildren.get(seg);
    if (staticNext) {
      const hit = this.#walk(staticNext, parts, index + 1, params);
      if (hit !== undefined) return hit;
    }
    if (node.paramChild) {
      params[node.paramChild.name] = seg;
      const hit = this.#walk(node.paramChild.node, parts, index + 1, params);
      if (hit !== undefined) return hit;
      delete params[node.paramChild.name];
    }
    if (node.wildcardChild) {
      params["*"] = parts.slice(index).join("/");
      return node.wildcardChild.value;
    }
    return undefined;
  }
}

interface LinearRoute<T> {
  readonly method: string;
  readonly path: string;
  readonly value: T;
  readonly parts: readonly string[];
}

/**
 * Linear router — fast registration, O(n) string-scan match.
 * Edge / cold-start preset (no compile phase).
 */
export class LinearRouter<T> implements Router<T> {
  readonly name = "LinearRouter";
  readonly #routes: LinearRoute<T>[] = [];

  /**
   * @param method - HTTP method
   * @param path - Path pattern
   * @param value - Route value
   */
  add(method: string, path: string, value: T): void {
    const parts = path.startsWith("/") ? path.split("/").slice(1) : path.split("/");
    this.#routes.push({ method, path, value, parts });
  }

  /**
   * @param method - HTTP method
   * @param path - Pathname
   */
  match(method: string, path: string): RouteMatch<T> | undefined {
    const pathParts = path.startsWith("/") ? path.split("/").slice(1) : path.split("/");
    if (pathParts.length > 0 && pathParts[pathParts.length - 1] === "") {
      pathParts.pop();
    }

    for (const route of this.#routes) {
      if (route.method !== method) continue;

      if (!route.path.includes(":") && !route.path.includes("*")) {
        if (route.path === path || `${route.path}/` === path) {
          return { value: route.value, params: {} };
        }
        continue;
      }

      const params: Record<string, string> = {};
      let pi = 0;
      let matched = true;

      for (let ri = 0; ri < route.parts.length; ri++) {
        const part = route.parts[ri] ?? "";
        if (part === "*") {
          params["*"] = pathParts.slice(pi).join("/");
          pi = pathParts.length;
          break;
        }
        if (pi >= pathParts.length) {
          matched = false;
          break;
        }
        const got = pathParts[pi] ?? "";
        if (part.startsWith(":") && part.length > 1) {
          const name = part.endsWith("?") ? part.slice(1, -1) : part.slice(1);
          params[name] = got;
          pi += 1;
          continue;
        }
        if (part !== got) {
          matched = false;
          break;
        }
        pi += 1;
      }

      if (matched && pi === pathParts.length) {
        return { value: route.value, params };
      }
    }
    return undefined;
  }
}

/** Factory that produces a fresh router candidate. */
export type RouterFactory<T> = () => Router<T>;

/**
 * Smart router — buffers routes, then at first match (startup) selects
 * RegExpRouter, falling back to TrieRouter on {@link UnsupportedPathError}.
 */
export class SmartRouter<T> implements Router<T> {
  name = "SmartRouter";
  readonly #factories: readonly RouterFactory<T>[];
  #routes: [string, string, T][] | undefined = [];
  #active: Router<T> | undefined;

  /**
   * @param init - Candidate factories, fastest first (fresh instance per try)
   */
  constructor(init: {
    readonly routers?: Router<T>[];
    readonly factories?: readonly RouterFactory<T>[];
  }) {
    if (init.factories) {
      this.#factories = init.factories;
    } else if (init.routers) {
      // Wrap pre-built instances once — prefer factories for isolation.
      this.#factories = init.routers.map((r) => () => r);
    } else {
      this.#factories = [];
    }
  }

  /**
   * @param method - HTTP method
   * @param path - Path pattern
   * @param value - Route value
   */
  add(method: string, path: string, value: T): void {
    if (!this.#routes) {
      throw new Error("SmartRouter matcher is already built");
    }
    this.#routes.push([method, path, value]);
  }

  /**
   * Force selection now (startup), without waiting for the first match.
   */
  build(): Router<T> {
    return this.#select();
  }

  /** Active delegate after {@link build} / first {@link match}. */
  get activeRouter(): Router<T> {
    if (!this.#active) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#active;
  }

  /**
   * @param method - HTTP method
   * @param path - Pathname
   */
  match(method: string, path: string): RouteMatch<T> | undefined {
    const active = this.#active ?? this.#select();
    return active.match(method, path);
  }

  #select(): Router<T> {
    if (this.#active) return this.#active;
    const routes = this.#routes;
    if (!routes) {
      throw new Error("SmartRouter has no routes buffer");
    }

    for (const factory of this.#factories) {
      const candidate = factory();
      try {
        for (const [method, path, value] of routes) {
          candidate.add(method, path, value);
        }
        if (candidate instanceof RegExpRouter) {
          candidate.build();
        }
        this.#active = candidate;
        this.name = `SmartRouter + ${candidate.name}`;
        this.#routes = undefined;
        this.match = candidate.match.bind(candidate);
        return candidate;
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
    }

    throw new Error("No router candidate accepted the registered routes");
  }
}

/** Router preset names. */
export type RouterPreset = "default" | "edge";

/**
 * Create a router for the given preset.
 *
 * - `default` — SmartRouter(RegExp → Trie), long-lived servers
 * - `edge` — SmartRouter(Linear → Trie), cold-start / one-shot isolates
 *
 * @param preset - Preset name
 */
export function createRouter<T>(preset: RouterPreset = "default"): SmartRouter<T> {
  if (preset === "edge") {
    return new SmartRouter<T>({
      factories: [() => new LinearRouter<T>(), () => new TrieRouter<T>()],
    });
  }
  return new SmartRouter<T>({
    factories: [() => new RegExpRouter<T>(), () => new TrieRouter<T>()],
  });
}
