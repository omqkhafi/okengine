/**
 * Image recipes and compose derivation.
 *
 * Recipes translate a normalised {@link ServiceSpec} into image-specific
 * env / command / healthcheck and expose {@link ImageRecipe.url} so the
 * kernel never learns an env-var name. Default layout is a single
 * production-grade `docker-compose.yml` (opt-in `--split` / `--stack`).
 * Credentials never enter YAML.
 */

export type {
  ComposeHealthcheck,
  ComposeLayout,
  DeriveOptions,
  DeriveResult,
  GeneratedFile,
  ImageRecipe,
  RecipeApplyResult,
  RecipeExtraPort,
  RecipePublishBind,
  RecipeUlimit,
  ServiceCredentials,
  ServiceEndpoint,
  ServiceSpec,
} from "./types.ts";

export { DEFAULT_DOCKER_DIR } from "./types.ts";

export {
  COMPOSE_ALL,
  COMPOSE_BASE,
  COMPOSE_OVERRIDE,
  DOCKER_COMPOSE,
  DOCKER_COMPOSE_OVERRIDE,
  DOCKER_STACK,
  assertNoCredentialsInYaml,
  buildSpecs,
  buildStackEnv,
  composePathRefs,
  deepMergeCompose,
  emitComposeLayers,
  formatStackEnv,
} from "./compose.ts";

export {
  DEFAULT_SERVER_BUDGET,
  allocateServiceResources,
  mergeDeployResources,
  resolveServerBudget,
  type ServerBudget,
  type ServiceResourceLimit,
} from "./resources.ts";

export { deriveInfrastructure, writeDerivedFiles } from "./derive.ts";
export { emitDockerfile } from "./dockerfile.ts";
export {
  composeToYaml,
  credEnv,
  envPrefix,
  serviceNameFor,
  type ComposeYamlOptions,
} from "./helpers.ts";
export { generateCredentials } from "./credentials.ts";
export {
  ensureOllamaModel,
  normalizeOllamaPullUrl,
  ollamaTagsInclude,
  parseOllamaTagsNames,
  OllamaPullError,
  type EnsureOllamaModelOptions,
  type OllamaFetch,
} from "./ollama-pull.ts";
export {
  aiModelIdsMatch,
  formatAiModelStatusMessage,
  normalizeAiProbeUrl,
  probeAiModelStatus,
  startAiModelWatch,
  statusFromOllamaTags,
  statusFromOpenAiModels,
  type AiModelFetch,
  type AiModelPhase,
  type AiModelProbeKind,
  type AiModelStatus,
  type ProbeAiModelStatusOptions,
  type StartAiModelWatchOptions,
} from "./ai-model-status.ts";
export {
  composeHealthByService,
  composeRowToStatus,
  parseComposePsJson,
  readComposeHealth,
  startComposeHealthWatch,
  watchComposeHealth,
  type ComposePsRow,
  type ReadComposeHealthOptions,
  type StartComposeHealthWatchOptions,
  type WatchComposeHealthOptions,
} from "./compose-health.ts";
export {
  builtinRecipes,
  caddy,
  cockroach,
  dragonfly,
  llamaCpp,
  buildLlamaCppEntrypoint,
  LLAMA_CPP_ENTRYPOINT_FILE,
  LLAMA_CPP_ENTRYPOINT_MOUNT,
  LLAMA_CPP_IMAGE,
  LLAMA_CPP_MIN_SAFE_BUILD,
  mailpit,
  meilisearch,
  ollama,
  OLLAMA_IMAGE,
  OLLAMA_MIN_SAFE_VERSION,
  pgdog,
  postgres,
  recipeFor,
  redis,
  rustfs,
  sglang,
  SGLANG_IMAGE,
  timescale,
  traefik,
  valkey,
  vllm,
  VLLM_IMAGE,
  yugabyte,
} from "./recipes/index.ts";
export { CADDY_APP_SERVICE, buildCaddyfile } from "./recipes/caddy.ts";
export {
  PGDOG_BACKEND_SERVICE,
  PGDOG_CONFIG_DIR,
  buildPgDogToml,
  buildPgDogUsersToml,
} from "./recipes/pgdog.ts";
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
