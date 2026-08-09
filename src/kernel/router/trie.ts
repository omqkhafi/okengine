/**
 * Trie router — supports wildcards and optional-style rests the RegExp
 * path cannot express. Used as SmartRouter fallback.
 */

import type { RouteMatch, Router } from "./types.ts";

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
