/**
 * Vite `apply: "serve"` plugin — boots an ephemeral Console kernel on :6533
 * so `bun run dev:console-next` prints the claim code in the same terminal.
 *
 * Set `OKE_CONSOLE_NEXT_SEEDED=1` (or `bun run dev:console-next:seeded`) to
 * load the same FLOWS_TEST_MANIFEST + WideEvent as the Playwright fixture.
 *
 * Requires Vite under Bun (`bunx --bun vite`): Node lacks `import.meta.dir`
 * used by the Console graph.
 */

import type { Plugin, ViteDevServer } from "vite";
import { isPortInUse } from "../../cli/ports.ts";
import { CONSOLE_PORT } from "../../runtime/types.ts";
import { serveConsole, type ConsoleServerHandle } from "../server/serve.ts";
import {
  appendUiNextSeedRun,
  isConsoleNextSeeded,
  UI_NEXT_SEEDED_MANIFEST,
  uiNextSeededSummary,
} from "./ui-next-seed.ts";

/** Vite SPA URL for ui-next (proxies `/console` → kernel :6533). */
const UI_NEXT_DEV_URL = "http://127.0.0.1:6537";

/**
 * Print post-boot instructions for seeded (or plain) console-next.
 *
 * @param log - Vite logger line writer
 * @param claimCode - First-admin claim code
 * @param seeded - Whether Manifest + run were seeded
 */
function printConsoleNextBanner(
  log: (msg: string) => void,
  claimCode: string,
  seeded: boolean,
): void {
  log("");
  log(`[oke] console-next ready`);
  log(`      URL:   ${UI_NEXT_DEV_URL}`);
  log(`      Claim: ${claimCode}`);
  if (seeded) {
    log(`      Seed:  ${uiNextSeededSummary()}`);
    log(`      Next:  open URL → claim → Flows (graph + Traces row already present)`);
  } else {
    log(`      Tip:   bun run dev:console-next:seeded  — all 8 elements + ~80 lived-in traces`);
  }
  log("");
}

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
      const seeded = isConsoleNextSeeded();

      if (await isPortInUse(port)) {
        server.config.logger.error(
          `\n[oke] Console port :${port} is already in use.\n` +
            `      Stop the other process, then re-run: bun run ${
              seeded ? "dev:console-next:seeded" : "dev:console-next"
            }\n`,
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
        ...(seeded ? { manifest: UI_NEXT_SEEDED_MANIFEST } : {}),
      });

      if (seeded) {
        const runs = handle.console.app.bootResult?.runs;
        if (!runs) {
          throw new Error("console-next seeded: Console bootResult.runs missing");
        }
        await appendUiNextSeedRun(runs);
        // Same thin host substitute as the Playwright fixture — Replay hits
        // real console.traces.replay → runReplay without a project entry.
        handle.console.state.replayTrace = async ({ event, dryRun }) => ({
          output: { replayed: event.id, dryRun, input: event.input ?? null },
        });
      }

      server.config.logger.info(`[oke] Console ${handle.url}`);
      printConsoleNextBanner(
        (msg) => {
          server.config.logger.info(msg);
        },
        handle.console.state.claim.code,
        seeded,
      );

      const onClose = (): void => {
        stop();
      };
      server.httpServer?.once("close", onClose);
      process.once("SIGINT", onClose);
      process.once("SIGTERM", onClose);
    },
  };
}
