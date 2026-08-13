/**
 * Smart router — buffers routes, then at first match (startup) selects
 * the first candidate that accepts every pattern, falling back on
 * {@link UnsupportedPathError}.
 */

import { UnsupportedPathError, type RouteMatch, type Router, type RouterFactory } from "./types.ts";

/**
 * Smart router — buffers routes, then at first match (startup) selects
 * a candidate, falling back to the next on {@link UnsupportedPathError}.
 *
 * Duck-types an optional `build()` so RegExpRouter can compile without
 * a hard `instanceof` import (keeps edge presets free of regexp.ts).
 */
export class SmartRouter<T> implements Router<T> {
  name = "SmartRouter";
  readonly #factories: readonly RouterFactory<T>[];
  /** Permanent route list (survives rebuilds for late auth bindings). */
  readonly #allRoutes: [string, string, T][] = [];
  /** Buffer until first {@link #select}; cleared while a delegate is active. */
  #routes: [string, string, T][] | undefined = [];
  #active: Router<T> | undefined;
  /** Original {@link match} before a delegate is bound. */
  readonly #matchSelf: (method: string, path: string) => RouteMatch<T> | undefined;

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
    this.#matchSelf = (method, path) => {
      const active = this.#active ?? this.#select();
      return active.match(method, path);
    };
    this.match = this.#matchSelf;
  }

  /**
   * @param method - HTTP method
   * @param path - Path pattern
   * @param value - Route value
   */
  add(method: string, path: string, value: T): void {
    this.#allRoutes.push([method, path, value]);
    if (this.#routes) {
      this.#routes.push([method, path, value]);
      return;
    }
    // Late registration after first match (e.g. auth HTTP at boot) — rebuild.
    this.#active = undefined;
    this.#routes = this.#allRoutes.slice();
    this.match = this.#matchSelf;
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
    return this.#matchSelf(method, path);
  }

  /**
   * @param path - Pathname
   */
  allowedMethods(path: string): string[] {
    return (this.#active ?? this.#select()).allowedMethods(path);
  }

  #select(): Router<T> {
    if (this.#active) return this.#active;
    const routes = this.#routes ?? this.#allRoutes;

    for (const factory of this.#factories) {
      const candidate = factory();
      try {
        for (const [method, path, value] of routes) {
          candidate.add(method, path, value);
        }
        if ("build" in candidate && typeof candidate.build === "function") {
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
