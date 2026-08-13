/**
 * Linear router — fast registration, O(n) string-scan match.
 * Edge / cold-start preset (no compile phase).
 */

import type { RouteMatch, Router } from "./types.ts";

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

  /**
   * @param path - Pathname
   */
  allowedMethods(path: string): string[] {
    return this.#routes.map((r) => r.method).filter((m) => this.match(m, path));
  }
}
