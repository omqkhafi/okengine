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
 * - `OKE_ROOT_DIR` — project root for Manifest extract (defaults to cwd)
 * - `OKE_MANIFEST_PATH` — optional JSON Manifest from the parent `oke dev`
 *   extract (avoids a second extract in the child; Windows-safe fallback)
 *
 * Soft reload must not clear the TTY — the parent `oke dev` board owns
 * Docker status and the first-admin claim code.
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { installGracefulShutdown, type GracefulShutdownApp } from "../kernel/graceful-shutdown.ts";
import type { Manifest } from "../manifest/types.ts";
import { createBunRuntime } from "../runtime/bun.ts";
import { APP_PORT, type FetchApp } from "../runtime/types.ts";
import { formatAppReadyLine } from "../term.ts";

/** Stable Bun.serve id so `--hot` reuses the socket across soft reloads. */
export const DEV_APP_SERVE_ID = "oke-dev-app";

/** App entry shape — FetchApp plus boot before serve. */
type BootableApp = FetchApp & {
  boot(overrides?: { readonly rootDir?: string; readonly manifest?: Manifest }): Promise<unknown>;
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

// Signal to boot() where to lazily extract effects from when a flow has no
// hand-declared `effects` — kernel/boot.ts's mintCapabilities() reads this
// (explicit opt-in only; the kernel itself never defaults to cwd). `cwd` is
// already the project root here (Bun.spawn's `cwd` option in dev.ts).
process.env["OKE_ROOT_DIR"] ??= process.cwd();

const manifestPath = Bun.env["OKE_MANIFEST_PATH"];
let manifest: Manifest | undefined;
if (manifestPath !== undefined && manifestPath.length > 0) {
  try {
    manifest = (await Bun.file(manifestPath).json()) as Manifest;
  } catch (err) {
    console.error(
      `oke dev-app-runner: OKE_MANIFEST_PATH unreadable — ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

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

try {
  await mod.app.boot({
    rootDir: process.env["OKE_ROOT_DIR"],
    ...(manifest !== undefined ? { manifest } : {}),
  });
} catch (err) {
  // `bun --hot` keeps the watcher alive on an uncaught throw, so `oke dev`
  // would wait the full ready timeout after VaultBootError. Exit so the
  // parent sees a dead child immediately.
  console.error(err);
  process.exit(1);
}
const handle = createBunRuntime().serve(mod.app, {
  port,
  hostname,
  id: DEV_APP_SERVE_ID,
});
installGracefulShutdown({ app: mod.app, handle });

const appUrl = `http://${formatHostForUrl(hostname)}:${handle.port}`;
// Parent board (claim + Docker) stays. Bun `--no-clear-screen` + no child wipe.
process.stdout.write(formatAppReadyLine(appUrl));

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
