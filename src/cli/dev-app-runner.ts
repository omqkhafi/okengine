/**
 * `oke dev` app child — tiny entry run under `bun --hot`.
 *
 * Does exactly what default {@link import("./dev.ts").DevOptions.startApp}
 * must: import the user app → `boot()` → `createBunRuntime().serve`.
 * Bun soft-reloads this file and the watched app graph while preserving
 * the listen socket (`Bun.serve` id {@link DEV_APP_SERVE_ID}).
 *
 * Env:
 * - `OKE_ENTRY` — absolute (or cwd-relative) path to the app module
 * - `PORT` — listen port (`0` = ephemeral)
 * - `OKE_HOSTNAME` — listen hostname (default `127.0.0.1`)
 * - `OKE_READY_PATH` — when set, write bound port here once listening
 * - `OKE_DEV_HERO_CONSOLE` / `OKE_DEV_HERO_MCP` — URL lines for soft-reload hero
 * - `OKE_DEV_HERO_META` — JSON {@link import("./hero-meta.ts").DevHeroSnapshot}
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { installGracefulShutdown, type GracefulShutdownApp } from "../kernel/graceful-shutdown.ts";
import { createBunRuntime } from "../runtime/bun.ts";
import { APP_PORT, type FetchApp } from "../runtime/types.ts";
import { clearTerminalScreen, formatAppReadyLine, formatDevHero } from "../term.ts";
import { decodeHeroSnapshot } from "./hero-meta.ts";

/** Stable Bun.serve id so `--hot` reuses the socket across soft reloads. */
export const DEV_APP_SERVE_ID = "oke-dev-app";

/** Survives `bun --hot` soft reload — marks second+ evaluation. */
type DevRunnerGlobals = typeof globalThis & {
  __okeDevSoftReload?: boolean;
};

/** App entry shape — FetchApp plus boot before serve. */
type BootableApp = FetchApp & {
  boot(): Promise<unknown>;
  stop(): Promise<void>;
  readonly bootResult?: GracefulShutdownApp["bootResult"];
};

const entry = Bun.env["OKE_ENTRY"];
if (entry === undefined || entry.length === 0) {
  console.error("oke dev-app-runner: OKE_ENTRY is required");
  process.exit(1);
}

const port = Number(Bun.env["PORT"] ?? APP_PORT);
const hostname = Bun.env["OKE_HOSTNAME"] ?? "127.0.0.1";
const readyPath = Bun.env["OKE_READY_PATH"];
const consoleUrl = Bun.env["OKE_DEV_HERO_CONSOLE"];
const mcpUrl = Bun.env["OKE_DEV_HERO_MCP"];
const heroMeta = decodeHeroSnapshot(Bun.env["OKE_DEV_HERO_META"]);

// Signal to boot() where to lazily extract effects from when a flow has no
// hand-declared `effects` — kernel/boot.ts's mintCapabilities() reads this
// (explicit opt-in only; the kernel itself never defaults to cwd). `cwd` is
// already the project root here (Bun.spawn's `cwd` option in dev.ts).
process.env["OKE_ROOT_DIR"] ??= process.cwd();

const absoluteEntry = resolve(entry);
const mod = (await import(pathToFileURL(absoluteEntry).href)) as {
  app?: BootableApp;
};

if (
  mod.app === undefined ||
  typeof mod.app.boot !== "function" ||
  typeof mod.app.fetch !== "function"
) {
  console.error(`oke dev: ${absoluteEntry} must export app with boot() and fetch()`);
  process.exit(1);
}

await mod.app.boot();
const handle = createBunRuntime().serve(mod.app, {
  port,
  hostname,
  id: DEV_APP_SERVE_ID,
});
installGracefulShutdown({ app: mod.app, handle });

const appUrl = `http://${formatHostForUrl(hostname)}:${handle.port}`;
const g = globalThis as DevRunnerGlobals;
const isSoftReload = g.__okeDevSoftReload === true;
g.__okeDevSoftReload = true;

if (
  isSoftReload &&
  consoleUrl !== undefined &&
  consoleUrl.length > 0 &&
  mcpUrl !== undefined &&
  mcpUrl.length > 0
) {
  // Drop request logs; keep the hero (Bun --no-clear-screen + our reprint).
  process.stdout.write(clearTerminalScreen());
  process.stdout.write(
    formatDevHero({
      appUrl,
      consoleUrl,
      mcpUrl,
      profile: heroMeta?.profile,
      runtimeEnv: heroMeta?.runtimeEnv,
      system: heroMeta?.system,
      elements: heroMeta?.elements,
      version: heroMeta?.version,
    }),
  );
} else {
  process.stdout.write(formatAppReadyLine(appUrl));
}

if (readyPath !== undefined && readyPath.length > 0) {
  await Bun.write(readyPath, `${handle.port}\n`);
}

/**
 * Format a hostname for use in a URL (bracket IPv6).
 *
 * @param host - Hostname
 */
function formatHostForUrl(host: string): string {
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`;
  return host;
}
