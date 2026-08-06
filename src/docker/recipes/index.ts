/**
 * Built-in image recipes — match by image ref, never by vendor driver id.
 */

import type { ImageRecipe } from "../types.ts";
import { caddy } from "./caddy.ts";
import { dragonfly } from "./dragonfly.ts";
import { mailpit } from "./mailpit.ts";
import { meilisearch } from "./meilisearch.ts";
import { ollama } from "./ollama.ts";
import { openbao } from "./openbao.ts";
import { pgdog } from "./pgdog.ts";
import { postgres } from "./postgres.ts";
import { redis } from "./redis.ts";
import { rustfs } from "./rustfs.ts";
import { supabase } from "./supabase.ts";
import { traefik } from "./traefik.ts";
import { valkey } from "./valkey.ts";

/** Default recipe catalogue — more specific image matches before protocol peers. */
export const builtinRecipes: readonly ImageRecipe[] = [
  supabase,
  postgres,
  pgdog,
  dragonfly,
  valkey,
  redis,
  mailpit,
  rustfs,
  openbao,
  meilisearch,
  ollama,
  caddy,
  traefik,
];

export {
  caddy,
  dragonfly,
  mailpit,
  meilisearch,
  ollama,
  openbao,
  pgdog,
  postgres,
  redis,
  rustfs,
  supabase,
  traefik,
  valkey,
};

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
