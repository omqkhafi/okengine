/**
 * Image recipes and compose derivation.
 *
 * Recipes translate a normalised {@link ServiceSpec} into image-specific
 * env / command / healthcheck and expose {@link ImageRecipe.url} so the
 * kernel never learns an env-var name. Four compose override layers end
 * in an untouched `compose.override.yml`. Credentials never enter YAML.
 */

export type {
  ComposeHealthcheck,
  DeriveOptions,
  DeriveResult,
  GeneratedFile,
  ImageRecipe,
  RecipeApplyResult,
  ServiceCredentials,
  ServiceEndpoint,
  ServiceSpec,
} from "./types.ts";

export {
  COMPOSE_OVERRIDE,
  assertNoCredentialsInYaml,
  buildSpecs,
  buildStackEnv,
  emitComposeLayers,
  formatStackEnv,
} from "./compose.ts";

export { deriveInfrastructure, writeDerivedFiles } from "./derive.ts";
export { emitDockerfile } from "./dockerfile.ts";
export { credEnv, envPrefix, serviceNameFor } from "./helpers.ts";
export { generateCredentials } from "./credentials.ts";
export {
  builtinRecipes,
  postgres,
  recipeFor,
  redis,
} from "./recipes/index.ts";
export {
  formatStackPreview,
  resolveStack,
  type StackRow,
} from "./stack.ts";
export {
  formatImagesLock,
  pinImages,
  type DigestResolver,
  type ImageLockEntry,
  type ImagesLock,
} from "./pin.ts";
