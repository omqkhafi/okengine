/**
 * Default long-lived server router preset — RegExp → Trie.
 */

import { RegExpRouter } from "./regexp.ts";
import { SmartRouter } from "./smart.ts";
import { TrieRouter } from "./trie.ts";

/**
 * Create the default SmartRouter (RegExp → Trie) for long-lived servers.
 */
export function createDefaultRouter<T>(): SmartRouter<T> {
  return new SmartRouter<T>({
    factories: [() => new RegExpRouter<T>(), () => new TrieRouter<T>()],
  });
}
