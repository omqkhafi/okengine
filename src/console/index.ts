/**
 * Console — operator plane UI + server (port 6533).
 *
 * Built on `createClient<ConsoleApp>`. Every action is a real flow through `fx`;
 * the audit log is the trace (docs/spec/console.md).
 * @module
 */

export {
  bootConsoleApp,
  CLAIM_TTL_MS,
  CONSOLE_COOKIES,
  CONSOLE_CSP,
  PLUGIN_IFRAME_SANDBOX,
  consolePlugin,
  createConsoleApp,
  createConsoleState,
  feedManifest,
  mintClaimCode,
  printClaimCodeOnce,
  serveConsole,
  startConsoleApp,
  verifyClaimCode,
  withConsoleSecurityHeaders,
  type ConsoleApp,
  type ConsoleAppHandle,
  type ConsoleServerHandle,
  type ConsoleState,
  type CreateConsoleAppOptions,
  type ServeConsoleOptions,
} from "./server/index.ts";
