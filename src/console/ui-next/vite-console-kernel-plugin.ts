/**
 * Vite `apply: "serve"` plugin — boots an ephemeral Console kernel on :6533
 * so `bun run dev:console-next` prints the claim code in the same terminal.
 *
 * Requires Vite under Bun (`bunx --bun vite`): Node lacks `import.meta.dir`
 * used by the Console graph.
 */

import type { Plugin, ViteDevServer } from "vite";
import { isPortInUse } from "../../cli/ports.ts";
import { CONSOLE_PORT } from "../../runtime/types.ts";
import { serveConsole, type ConsoleServerHandle } from "../server/serve.ts";

/**
 * Start Console beside the ui-next Vite server (dev only, not `vite build`).
 */
export function okeConsoleKernelPlugin(): Plugin {
  let handle: ConsoleServerHandle | null = null;
  let stopping = false;

  const stop = (): void => {
    if (stopping || !handle) return;
    stopping = true;
    try {
      handle.stop(true);
    } catch {
      // ignore
    }
    handle = null;
  };

  return {
    name: "oke-console-next-kernel",
    apply: "serve",
    async configureServer(server: ViteDevServer) {
      if (typeof Bun === "undefined") {
        server.config.logger.error(
          `\n[oke] Run Vite under Bun:\n` +
            `        bunx --bun vite --config src/console/ui-next/vite.config.ts\n` +
            `      (package script \`dev:console-next\` already does this)\n`,
        );
        process.exit(1);
      }

      const port = CONSOLE_PORT;
      const hostname = "127.0.0.1";

      if (await isPortInUse(port)) {
        server.config.logger.error(
          `\n[oke] Console port :${port} is already in use.\n` +
            `      Stop the other process, then re-run: bun run dev:console-next\n`,
        );
        process.exit(1);
      }

      // Local SPA kernel: claim + Vite matter; Channel/OPEN-token honesty
      // lines are noise here (same latch `oke dev` uses on Backend children).
      process.env["OKE_SUPPRESS_BOOT_WARN"] = "1";

      handle = await serveConsole({
        port,
        hostname,
        cwd: process.cwd(),
        persist: false,
        silentClaim: false,
        env: "test",
        secret: process.env.OKE_CONSOLE_SECRET ?? "oke-console-next-dev-secret",
      });

      server.config.logger.info(`[oke] Console ${handle.url}`);

      const onClose = (): void => {
        stop();
      };
      server.httpServer?.once("close", onClose);
      process.once("SIGINT", onClose);
      process.once("SIGTERM", onClose);
    },
  };
}
