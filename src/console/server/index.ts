/**
 * Console server — flows, live channel, Manifest feed, security.
 */

export {
  bootConsoleApp,
  createConsoleApp,
  type ConsoleApp,
  type ConsoleAppHandle,
  type CreateConsoleAppOptions,
} from "./app.ts";
export {
  CLAIM_RATE_LIMIT,
  CLAIM_RATE_WINDOW_MS,
  CLAIM_TTL_MS,
  constantTimeEqual,
  mintClaimCode,
  printClaimCodeOnce,
  verifyClaimCode,
  type ClaimCodeState,
  type ClaimVerifyResult,
} from "./claim.ts";
export {
  createConsoleBindings,
  PUBLIC_CONSOLE_FLOWS,
} from "./flows.ts";
export {
  createLiveWebsocket,
  feedManifest,
  subscribeLive,
  type ConsoleLiveData,
} from "./live.ts";
export { consolePlugin } from "./plugin.ts";
export {
  CONSOLE_COOKIES,
  CONSOLE_CSP,
  PLUGIN_FRAME_CSP,
  PLUGIN_IFRAME_SANDBOX,
  consoleSessionCookie,
  withConsoleSecurityHeaders,
} from "./security-headers.ts";
export {
  attachSessionCookies,
  serveConsole,
  startConsoleApp,
  withCookieAuth,
  type ConsoleServerHandle,
  type ServeConsoleOptions,
} from "./serve.ts";
export {
  createConsoleState,
  publishLive,
  setManifest,
  type ConsoleIdentity,
  type ConsoleLiveMessage,
  type ConsoleState,
  type CreateConsoleStateOptions,
} from "./state.ts";
export {
  createFileDiff,
  emitStructuralDiff,
  type EmitStructuralDiffOptions,
  type StructuralProposal,
} from "./structural.ts";
