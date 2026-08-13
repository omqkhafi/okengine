/**
 * HTTP router — re-export barrel for `./router.ts` import paths.
 *
 * Implementation lives under `./router/` for tree-shaking (edge can omit
 * RegExpRouter by importing `createEdgeRouter` only).
 */

export {
  createDefaultRouter,
  createEdgeRouter,
  createRouter,
  formatAllowHeader,
  isUnsupportedByRegExp,
  LinearRouter,
  RegExpRouter,
  SmartRouter,
  sortAllowMethods,
  TrieRouter,
  UnsupportedPathError,
  type RouteMatch,
  type Router,
  type RouterFactory,
  type RouterPreset,
} from "./router/index.ts";
