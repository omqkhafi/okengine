/**
 * HTTP router — compiled RegExp matching with a Trie fallback, plus a linear
 * preset for cold-start edge builds.
 *
 * Chosen at build/startup: try RegExp first; on unsupported patterns fall
 * back to Trie. The `edge` preset uses LinearRouter for fast registration.
 */

export { createRouter } from "./create.ts";
export { createDefaultRouter } from "./create-default.ts";
export { createEdgeRouter } from "./create-edge.ts";
export { LinearRouter } from "./linear.ts";
export { RegExpRouter } from "./regexp.ts";
export { SmartRouter } from "./smart.ts";
export { TrieRouter } from "./trie.ts";
export {
  formatAllowHeader,
  sortAllowMethods,
  UnsupportedPathError,
  isUnsupportedByRegExp,
  type RouteMatch,
  type Router,
  type RouterFactory,
  type RouterPreset,
} from "./types.ts";
