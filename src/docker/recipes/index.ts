/**
 * Built-in image recipes — match by image ref, never by vendor driver id.
 */

import type { ImageRecipe } from "../types.ts";
import { caddy } from "./caddy.ts";
import { cockroach } from "./cockroach.ts";
import { dragonfly } from "./dragonfly.ts";
import { llamaCpp } from "./llama-cpp.ts";
import { mailpit } from "./mailpit.ts";
import { meilisearch } from "./meilisearch.ts";
import { ollama } from "./ollama.ts";
import { pgdog } from "./pgdog.ts";
import { postgres } from "./postgres.ts";
import { redis } from "./redis.ts";
import { rustfs } from "./rustfs.ts";
import { sglang } from "./sglang.ts";
import { supabase } from "./supabase.ts";
import { timescale } from "./timescale.ts";
import { traefik } from "./traefik.ts";
import { valkey } from "./valkey.ts";
import { vllm } from "./vllm.ts";
import { yugabyte } from "./yugabyte.ts";

/** Default recipe catalogue — more specific image matches before protocol peers. */
export const builtinRecipes: readonly ImageRecipe[] = [
  cockroach,
  yugabyte,
  timescale,
  supabase,
  postgres,
  pgdog,
  dragonfly,
  valkey,
  redis,
  mailpit,
  rustfs,
  meilisearch,
  llamaCpp,
  vllm,
  sglang,
  ollama,
  caddy,
  traefik,
];

export {
  caddy,
  cockroach,
  dragonfly,
  llamaCpp,
  mailpit,
  meilisearch,
  ollama,
  pgdog,
  postgres,
  redis,
  rustfs,
  sglang,
  supabase,
  timescale,
  traefik,
  valkey,
  vllm,
  yugabyte,
};

export {
  buildLlamaCppEntrypoint,
  LLAMA_CPP_ENTRYPOINT_FILE,
  LLAMA_CPP_ENTRYPOINT_HOST_PATH,
  LLAMA_CPP_ENTRYPOINT_MOUNT,
  LLAMA_CPP_IMAGE,
  LLAMA_CPP_MIN_SAFE_BUILD,
} from "./llama-cpp.ts";
export { OLLAMA_IMAGE, OLLAMA_MIN_SAFE_VERSION } from "./ollama.ts";
export { SGLANG_IMAGE } from "./sglang.ts";
export { VLLM_IMAGE } from "./vllm.ts";

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
