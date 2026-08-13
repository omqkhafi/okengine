/**
 * Shared router types, errors, and RegExp-support probe.
 */

/** Thrown when a router cannot express a path pattern. */
export class UnsupportedPathError extends Error {
  /** Offending path pattern. */
  readonly path: string;

  /**
   * @param path - Offending path pattern
   */
  constructor(path: string) {
    super(path);
    this.name = "UnsupportedPathError";
    this.path = path;
  }
}

/** One match result. */
export interface RouteMatch<T> {
  readonly value: T;
  readonly params: Readonly<Record<string, string>>;
}

/**
 * Canonical `Allow` order (RFC 9110 does not require one; keep the header
 * stable across router strategies). Unknown verbs sort after these.
 */
const ALLOW_ORDER = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "QUERY"] as const;

/**
 * Deduplicate and order methods for an `Allow` header.
 *
 * @param methods - Registered methods that match the request path
 */
export function sortAllowMethods(methods: readonly string[]): string[] {
  const seen = new Set(methods.map((m) => m.toUpperCase()));
  const ordered: string[] = [];
  for (const method of ALLOW_ORDER) {
    if (seen.has(method)) {
      ordered.push(method);
      seen.delete(method);
    }
  }
  ordered.push(...[...seen].sort());
  return ordered;
}

/**
 * `Allow` header value listing every method registered for a path.
 *
 * @param methods - Registered methods that match the request path
 */
export function formatAllowHeader(methods: readonly string[]): string {
  return sortAllowMethods(methods).join(", ");
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
  /**
   * HTTP methods registered for `path` (wrong-method → 405). Empty when
   * the path matches no route.
   *
   * @param path - Request pathname
   */
  allowedMethods(path: string): string[];
}

/** True when the pattern cannot be expressed by the RegExp strategy. */
export function isUnsupportedByRegExp(path: string): boolean {
  // optional params, wildcards, custom regex segments, greedy rests
  return /\/:/.test(path) === false ? /[*?{}()]/.test(path) : /[*?{}]|\/:[^/]+\?/.test(path);
}

/** Factory that produces a fresh router candidate. */
export type RouterFactory<T> = () => Router<T>;

/** Router preset names. */
export type RouterPreset = "default" | "edge";
