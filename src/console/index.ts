/**
 * Console — operator plane UI + server (port 6533).
 *
 * Built on `createClient<ConsoleApp>`. Every action is a real flow through `fx`;
 * the audit log is the trace (docs/spec/console.md).
 *
 * Imports leaf modules (not `server/index`) so unused panel projectors stay out
 * of the `okengine/console` graph when tree-shaken.
 *
 * @module
 */

export {
  bootConsoleApp,
  createConsoleApp,
  type ConsoleApp,
  type ConsoleAppHandle,
  type CreateConsoleAppOptions,
} from "./server/app.ts";
export {
  CLAIM_TTL_MS,
  mintClaimCode,
  printClaimCodeOnce,
  verifyClaimCode,
} from "./server/claim.ts";
export { feedManifest } from "./server/live.ts";
export { consolePlugin } from "./server/plugin.ts";
export {
  CONSOLE_COOKIES,
  CONSOLE_CSP,
  PLUGIN_IFRAME_SANDBOX,
  withConsoleSecurityHeaders,
} from "./server/security-headers.ts";
export {
  serveConsole,
  startConsoleApp,
  type ConsoleServerHandle,
  type ServeConsoleOptions,
} from "./server/serve.ts";
export { createConsoleState, type ConsoleState } from "./server/state.ts";
