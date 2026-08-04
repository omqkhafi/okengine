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
  RecipeExtraPort,
  RecipeUlimit,
  ServiceCredentials,
  ServiceEndpoint,
  ServiceSpec,
} from "./types.ts";

export { DEFAULT_DOCKER_DIR } from "./types.ts";

export {
  COMPOSE_ALL,
  COMPOSE_OVERRIDE,
  assertNoCredentialsInYaml,
  buildSpecs,
  buildStackEnv,
  composePathRefs,
  deepMergeCompose,
  emitComposeLayers,
  formatStackEnv,
} from "./compose.ts";

export { deriveInfrastructure, writeDerivedFiles } from "./derive.ts";
export { emitDockerfile } from "./dockerfile.ts";
export { credEnv, envPrefix, serviceNameFor } from "./helpers.ts";
export { generateCredentials } from "./credentials.ts";
export {
  builtinRecipes,
  caddy,
  dragonfly,
  mailpit,
  meilisearch,
  ollama,
  openbao,
  pgdog,
  postgres,
  recipeFor,
  redis,
  rustfs,
  traefik,
  valkey,
} from "./recipes/index.ts";
export { CADDY_APP_SERVICE, buildCaddyfile } from "./recipes/caddy.ts";
export { PGDOG_BACKEND_SERVICE, buildPgDogToml, buildPgDogUsersToml } from "./recipes/pgdog.ts";
export { SOCKET_PROXY_IMAGE, SOCKET_PROXY_SERVICE, traefikAppLabels } from "./recipes/traefik.ts";
export {
  formatStackPreview,
  resolveExtraPorts,
  resolveStack,
  type StackExtraPort,
  type StackRow,
} from "./stack.ts";
export {
  extraHostPortForInstance,
  hostPortForInstance,
  instancePortOffset,
  loadExistingStackControls,
  loadExistingStackCredentials,
  parseStackControls,
  parseStackCredentials,
  STACK_CONTROL_KEYS,
  stackAppSlug,
  stackInstanceId,
} from "./stack-id.ts";
export {
  OKE_DEV_PROJECT_RE,
  composeProjectName,
  defaultDockerRunner,
  downStack,
  isOkeDevProject,
  isOkeProjectRoot,
  listOkeComposeProjects,
  listStackContainers,
  parseJsonRecords,
  projectFromResourceName,
  projectsFromContainerSelection,
  resolveSelection,
  selectionKey,
  type DockerRunResult,
  type DockerRunner,
  type OkeContainer,
  type OkeStack,
} from "./cleanup.ts";
export {
  formatImagesLock,
  pinImages,
  type DigestResolver,
  type ImageLockEntry,
  type ImagesLock,
} from "./pin.ts";
