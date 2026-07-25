/**
 * Typed client (+ live). Subpath: `okengine/client`.
 *
 * First Manifest derivation: `type App` → fully typed client, zero codegen.
 * @module
 */

export { createClient, flattenRoutes } from "./create.ts";
export type { AppWithRoutes } from "./create.ts";
export {
  isErrorCode,
  isFail,
  isOk,
  isTransportError,
} from "./errors.ts";
export { createTransport } from "./transport.ts";
export type { Transport } from "./transport.ts";
export type {
  AppOf,
  Client,
  ClientApp,
  ClientCall,
  ClientDescriptor,
  ClientError,
  ClientFetch,
  ClientFromRoutes,
  ClientHeaders,
  ClientOptions,
  ClientResult,
  ClientRouteMap,
  FlowContract,
  Register,
  ResolveApp,
  RoutesOf,
  TransportError,
} from "./types.ts";
