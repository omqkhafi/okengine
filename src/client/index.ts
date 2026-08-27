/**
 * Typed client (+ live). Subpath: `okengine/client`.
 *
 * First Manifest derivation: `type App` → fully typed client, zero codegen.
 * @module
 */

export {
  flattenLiveRoutes,
  isLiveHandlers,
  LIVE_RESUBSCRIBE_INITIAL_MS,
  LIVE_RESUBSCRIBE_MAX_MS,
  nextResubscribeDelay,
  pickLiveExposure,
} from "./live.ts";
export { createClient, flattenRoutes, transportOf } from "./create.ts";
export type { AppWithRoutes, TransportBag } from "./create.ts";
export { isErrorCode, isFail, isOk, isTransportError } from "./errors.ts";
export { isPagerMeta, pagerLink } from "./pager.ts";
export type { ClientPager, PagerLink } from "./pager.ts";
export {
  applyOptimisticPatch,
  clearOptimisticPatch,
  isStaleUpsert,
  reduceLiveQueryRows,
} from "./use-live-query.ts";
export type { LiveQueryError, LiveQueryEvent } from "./use-live-query.ts";
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
  ClientEnvelope,
  ClientListMeta,
  ClientPagerLink,
  ClientResult,
  ClientThenableIterable,
  ClientRouteMap,
  ClientLive,
  FlowContract,
  LiveHandlers,
  LiveInput,
  LiveSignalHandle,
  LiveUnsubscribe,
  Register,
  ResolveApp,
  RoutesOf,
  TransportError,
} from "./types.ts";
