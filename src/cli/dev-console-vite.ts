/**
 * Attach Vite HMR to `oke dev` Console when developing okengine itself.
 *
 * Published installs serve `ui-next/dist`. A source checkout would otherwise
 * require `bun run build` after every Console UI edit — Vite transforms the
 * SPA and `serveConsole` proxies non-kernel paths through to it.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort } from "./ports.ts";

/** Preferred Vite HMR port (`dev:console` uses the same). */
export const CONSOLE_VITE_PORT = 6537;

/** Env that disables the Vite kernel plugin (`oke dev` already bound :6533). */
export const CONSOLE_KERNEL_SKIP_ENV = "OKE_CONSOLE_KERNEL";

/** Env that points Vite's `/console` proxy at the live kernel. */
export const CONSOLE_PROXY_ENV = "OKE_CONSOLE_PROXY";

/** Env to force (`1`) or disable (`0`) Console Vite attach. */
export const CONSOLE_VITE_ENV = "OKE_CONSOLE_VITE";

/** Running Vite sidecar. */
export interface ConsoleViteHandle {
  readonly origin: string;
  readonly port: number;
  readonly stop: () => Promise<void>;
}

/** Options for {@link shouldAttachConsoleVite}. */
export interface ShouldAttachConsoleViteOptions {
  /** okengine package root (default: resolved from this module). */
  readonly packageRoot?: string;
  /** Env overlay (default: `process.env`). */
  readonly env?: NodeJS.ProcessEnv;
}

/** Options for {@link startConsoleVite}. */
export interface StartConsoleViteOptions {
  /** Already-resolved Console kernel port (`oke dev` board URL). */
  readonly consolePort: number;
  /** Preferred Vite listen port (default {@link CONSOLE_VITE_PORT}). */
  readonly preferredPort?: number;
  /** Ports already claimed by this `oke dev` session. */
  readonly occupied?: ReadonlySet<number>;
  /** okengine package root (default: resolved from this module). */
  readonly packageRoot?: string;
}

/**
 * Resolve the okengine package root from this CLI module.
 */
export function resolveOkenginePackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

/**
 * Whether `oke dev` should start Vite for Console UI HMR.
 *
 * On for an okengine source checkout (not `node_modules/okengine`).
 * `OKE_CONSOLE_VITE=0` disables; `=1` forces when the Vite config exists.
 *
 * @param options - Package root / env overrides (tests)
 */
export function shouldAttachConsoleVite(options: ShouldAttachConsoleViteOptions = {}): boolean {
  const env = options.env ?? process.env;
  const root = options.packageRoot ?? resolveOkenginePackageRoot();
  const configPath = join(root, "src/console/ui-next/vite.config.ts");
  if (!existsSync(configPath)) return false;

  const flag = env[CONSOLE_VITE_ENV];
  if (flag === "0") return false;
  if (flag === "1") return true;
  return !isNodeModulesPackageRoot(root);
}

/**
 * Start Vite in attach mode (no Console kernel) and return a stop handle.
 *
 * @param options - Kernel port + listen preference
 */
export async function startConsoleVite(
  options: StartConsoleViteOptions,
): Promise<ConsoleViteHandle> {
  const root = options.packageRoot ?? resolveOkenginePackageRoot();
  const configFile = join(root, "src/console/ui-next/vite.config.ts");
  const occupied = options.occupied ?? new Set<number>();
  const preferred = options.preferredPort ?? CONSOLE_VITE_PORT;
  const port = await findFreePort(preferred, occupied);

  const prevKernel = process.env[CONSOLE_KERNEL_SKIP_ENV];
  const prevProxy = process.env[CONSOLE_PROXY_ENV];
  const restoreEnv = (): void => {
    if (prevKernel === undefined) delete process.env[CONSOLE_KERNEL_SKIP_ENV];
    else process.env[CONSOLE_KERNEL_SKIP_ENV] = prevKernel;
    if (prevProxy === undefined) delete process.env[CONSOLE_PROXY_ENV];
    else process.env[CONSOLE_PROXY_ENV] = prevProxy;
  };
  process.env[CONSOLE_KERNEL_SKIP_ENV] = "0";
  process.env[CONSOLE_PROXY_ENV] = `http://127.0.0.1:${options.consolePort}`;

  try {
    const { createServer } = await import("vite");
    const server = await createServer({
      configFile,
      clearScreen: false,
      logLevel: "error",
      server: {
        port,
        strictPort: true,
        host: "127.0.0.1",
        ws: {
          host: "127.0.0.1",
          clientPort: port,
        },
      },
    });
    await server.listen();
    const listened = server.httpServer?.address();
    const boundPort = typeof listened === "object" && listened !== null ? listened.port : port;
    return {
      origin: `http://127.0.0.1:${boundPort}`,
      port: boundPort,
      async stop() {
        await server.close();
        restoreEnv();
      },
    };
  } catch (err) {
    restoreEnv();
    throw err;
  }
}

function isNodeModulesPackageRoot(root: string): boolean {
  const normalized = root.endsWith(sep) ? root.slice(0, -1) : root;
  return (
    normalized.endsWith(`${sep}node_modules${sep}okengine`) ||
    normalized.includes(`${sep}node_modules${sep}`)
  );
}
