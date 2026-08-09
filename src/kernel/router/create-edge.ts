/**
 * Edge / cold-start router preset — Linear → Trie (no RegExp compile).
 */

import { LinearRouter } from "./linear.ts";
import { SmartRouter } from "./smart.ts";
import { TrieRouter } from "./trie.ts";

/**
 * Create an edge-oriented SmartRouter (Linear → Trie).
 *
 * Does not import `regexp.ts`, so edge bundles can tree-shake RegExpRouter.
 */
export function createEdgeRouter<T>(): SmartRouter<T> {
  return new SmartRouter<T>({
    factories: [() => new LinearRouter<T>(), () => new TrieRouter<T>()],
  });
}
