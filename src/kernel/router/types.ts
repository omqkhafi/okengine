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

/** Factory that produces a fresh router candidate. */
export type RouterFactory<T> = () => Router<T>;

/** Router preset names. */
export type RouterPreset = "default" | "edge";
