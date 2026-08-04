/**
 * Built-in image recipes — match by image ref, never by vendor driver id.
 */

import type { ImageRecipe } from "../types.ts";
import { mailpit } from "./mailpit.ts";
import { meilisearch } from "./meilisearch.ts";
import { ollama } from "./ollama.ts";
import { openbao } from "./openbao.ts";
import { pgdog } from "./pgdog.ts";
import { postgres } from "./postgres.ts";
import { redis } from "./redis.ts";
import { rustfs } from "./rustfs.ts";

/** Default recipe catalogue. */
export const builtinRecipes: readonly ImageRecipe[] = [
  postgres,
  pgdog,
  redis,
  mailpit,
  rustfs,
  openbao,
  meilisearch,
  ollama,
];

export { mailpit, meilisearch, ollama, openbao, pgdog, postgres, redis, rustfs };

/**
 * Resolve the recipe for an image reference.
 *
 * @param image - Image pin
 * @param extra - Plugin / test recipes (tried first)
 */
export function recipeFor(image: string, extra: readonly ImageRecipe[] = []): ImageRecipe {
  for (const r of extra) {
    if (r.match(image)) return r;
  }
  for (const r of builtinRecipes) {
    if (r.match(image)) return r;
  }
  throw new Error(
    `oke docker: no image recipe matches ${JSON.stringify(image)} — add a recipe (≤15 lines) or pin a known image`,
  );
}
