/**
 * Resolve optional peer dependencies with a clear install hint.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Dynamically import an optional peer, or throw an actionable error.
 *
 * @param spec - Package name
 * @param feature - Human feature label for the error
 */
export async function importOptionalPeer<T>(spec: string, feature: string): Promise<T> {
  try {
    return (await import(spec)) as T;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${feature} requires optional peer \`${spec}\`. Install it with \`bun add ${spec}\`. (${detail})`,
    );
  }
}

/**
 * Synchronously require an optional peer, or throw an actionable error.
 *
 * @param spec - Package name
 * @param feature - Human feature label
 */
export function requireOptionalPeer<T>(spec: string, feature: string): T {
  try {
    return require(spec) as T;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${feature} requires optional peer \`${spec}\`. Install it with \`bun add ${spec}\`. (${detail})`,
    );
  }
}
