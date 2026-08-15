/**
 * Vite `apply: "serve"` plugin — boots an ephemeral Console kernel on :6533
 * so `bun run dev:console` prints login (or claim) details in the same terminal.
 *
 * Set `OKE_CONSOLE_SEEDED=1` (or `bun run dev:console:seed`) to
 * load the keel Manifest + WideEvent as the Playwright fixture.
 *
 * Set `OKE_CONSOLE_FRESH=1` (or `bun run dev:console:fresh`) to
 * skip the fixed operator and keep first-admin claim open.
 *
 * Requires Vite under Bun (`bunx --bun vite`): Node lacks `import.meta.dir`
 * used by the Console graph.
 */

import type { Plugin, ViteDevServer } from "vite";
import { isPortInUse } from "../../cli/ports.ts";
import { CONSOLE_PORT } from "../../runtime/types.ts";
import { serveConsole, type ConsoleServerHandle } from "../server/serve.ts";
import {
  isConsoleFresh,
  UI_NEXT_DEV_OPERATOR,
  seedUiNextDevOperator,
} from "./ui-next-dev-operator.ts";
import {
  appendUiNextSeedRun,
  isConsoleSeeded,
  UI_NEXT_SEEDED_MANIFEST,
  UI_NEXT_SEED_VAULT_LAYERS,
  uiNextSeededSummary,
} from "./ui-next-seed.ts";

/** Vite SPA URL for ui-next (proxies `/console` → kernel :6533). */
const UI_NEXT_DEV_URL = "http://127.0.0.1:6537";

/**
 * Print post-boot instructions for console-next (operator login or fresh claim).
 *
 * @param log - Vite logger line writer
 * @param options - Mode flags + optional claim code when fresh
 */
function printConsoleNextBanner(
  log: (msg: string) => void,
  options: {
    readonly seeded: boolean;
    readonly fresh: boolean;
    readonly claimCode: string;
  },
): void {
  const { seeded, fresh, claimCode } = options;
  log("");
  log(`[oke] console ready`);
  log(`      URL:   ${UI_NEXT_DEV_URL}`);
  if (fresh) {
    log(`      Claim: ${claimCode}`);
    log(`      Mode:  fresh (first-admin claim open)`);
  } else {
    log(`      Login: ${UI_NEXT_DEV_OPERATOR.email} / ${UI_NEXT_DEV_OPERATOR.password}`);
  }
  if (seeded) {
    log(`      Seed:  ${uiNextSeededSummary()}`);
    if (fresh) {
      log(`      Next:  open URL → claim → Overview (graph + Traces row already present)`);
    } else {
      log(`      Next:  open URL → Sign in → Overview (graph + Traces row already present)`);
    }
  } else if (!fresh) {
    log(`      Tip:   bun run dev:console:seed  — all 8 elements + ~80 lived-in traces`);
  } else {
    log(`      Tip:   bun run dev:console:fresh:seed  — claim + all 8 elements + ~80 traces`);
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
    name: "oke-console-kernel",
    apply: "serve",
    async configureServer(server: ViteDevServer) {
      if (typeof Bun === "undefined") {
        server.config.logger.error(
          `\n[oke] Run Vite under Bun:\n` +
            `        bunx --bun vite --config src/console/ui-next/vite.config.ts\n` +
            `      (package script \`dev:console\` already does this)\n`,
        );
        process.exit(1);
      }

      const port = CONSOLE_PORT;
      const hostname = "127.0.0.1";
      const seeded = isConsoleSeeded();
      const fresh = isConsoleFresh();

      if (await isPortInUse(port)) {
        server.config.logger.error(
          `\n[oke] Console port :${port} is already in use.\n` +
            `      Stop the other process, then re-run: bun run ${
              fresh
                ? seeded
                  ? "dev:console:fresh:seed"
                  : "dev:console:fresh"
                : seeded
                  ? "dev:console:seed"
                  : "dev:console"
            }\n`,
        );
        process.exit(1);
      }

      // Local SPA kernel: claim + Vite matter; Channel/OPEN-token honesty
      // lines are noise here (same latch `oke dev` uses on Backend children).
      process.env["OKE_SUPPRESS_BOOT_WARN"] = "1";

      const operators = fresh ? undefined : (await seedUiNextDevOperator()).store;

      handle = await serveConsole({
        port,
        hostname,
        cwd: process.cwd(),
        persist: false,
        silentClaim: !fresh,
        env: "test",
        secret: process.env.OKE_CONSOLE_SECRET ?? "oke-console-next-dev-secret",
        ...(operators ? { operators } : {}),
        ...(seeded
          ? { manifest: UI_NEXT_SEEDED_MANIFEST, vaultLayerSeed: UI_NEXT_SEED_VAULT_LAYERS }
          : {}),
      });

      if (seeded) {
        const runs = handle.console.app.bootResult?.runs;
        if (!runs) {
          throw new Error("console seeded: Console bootResult.runs missing");
        }
        await appendUiNextSeedRun(runs);
        if (handle.console.state.storeRuntime) {
          const { seedUiNextStoreData } = await import("./ui-next-seed.ts");
          await seedUiNextStoreData(handle.console.state.storeRuntime);
        }
        // Same thin host substitute as the Playwright fixture — Replay hits
        // real console.traces.replay → runReplay without a project entry.
        handle.console.state.replayTrace = async ({ event, dryRun }) => ({
          output: { replayed: event.id, dryRun, input: event.input ?? null },
        });
        const { bootUiNextSeedInvoke } = await import("./seed-invoke-host.ts");
        const seedInvoke = await bootUiNextSeedInvoke({
          ...(handle.console.state.storeRuntime
            ? { storeRuntime: handle.console.state.storeRuntime }
            : {}),
          manifest: UI_NEXT_SEEDED_MANIFEST,
        });
        handle.console.state.invokeUserFlow = seedInvoke.invokeUserFlow;
      }

      server.config.logger.info(`[oke] Console ${handle.url}`);
      printConsoleNextBanner(
        (msg) => {
          server.config.logger.info(msg);
        },
        {
          seeded,
          fresh,
          claimCode: handle.console.state.claim.code,
        },
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
