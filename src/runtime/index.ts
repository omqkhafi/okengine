/**
 * Runtime adapters: Bun (primary) · Web Standards (Node / Deno / edge).
 */

export { createBunRuntime, buildBunRoutes, isBunNativePath, type BunRuntime } from "./bun.ts";

export {
  createEnv,
  createFiles,
  createTimers,
  createWebCrypto,
  createBunCrypto,
} from "./primitives.ts";

export {
  checkRequestSecurity,
  forbiddenResponse,
  isHostAllowed,
  normalizeHost,
  resolveAllowedHosts,
  secureFetch,
  type SecurityCheck,
} from "./security.ts";

export {
  APP_PORT,
  CONSOLE_PORT,
  DOCS_MCP_PORT,
  MCP_PORT,
  type FetchApp,
  type PasswordAlgorithm,
  type Runtime,
  type RuntimeCrypto,
  type RuntimeEnv,
  type RuntimeFiles,
  type RuntimeName,
  type RuntimeTimers,
  type ServeOptions,
  type ServerHandle,
} from "./types.ts";

export { createWebStandardRuntime } from "./web-standard.ts";
