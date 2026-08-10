/**
 * One-time interactive prompt: run `oke db seed` after first successful push.
 */

import { confirm, isCancel } from "@clack/prompts";
import type { ConfigEnv } from "../config/index.ts";
import { formatCliChrome } from "../term.ts";
import { resolveSeedModulePath, runSeed } from "./db-seed.ts";
import { isProjectSeeded, markProjectSeeded } from "./project-state.ts";

/** @deprecated Use `.oke/state.json` `seededAt` via {@link isProjectSeeded}. */
export { LEGACY_SEEDED_MARKER as SEEDED_MARKER } from "./project-state.ts";

/** Options for {@link maybeAskSeed}. */
export interface AskSeedOptions {
  readonly cwd: string;
  readonly env: ConfigEnv;
  readonly write?: (text: string) => void;
  readonly stdinIsTTY?: boolean;
  /** Skip prompt (tests / `--yes` / non-interactive). */
  readonly skip?: boolean;
  /** Injectable confirm (tests). */
  readonly confirmFn?: () => Promise<boolean>;
  /** Injectable seed runner (tests). */
  readonly seedFn?: (cwd: string, env: ConfigEnv) => Promise<number>;
}

/**
 * After a successful `oke db push`, ask once whether to seed sample data.
 * Skips when non-TTY, already seeded, or no seed module.
 *
 * @param options - Project / env / injectables
 */
export async function maybeAskSeed(options: AskSeedOptions): Promise<void> {
  if (options.skip) return;
  const tty = options.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  if (!tty) return;

  const cwd = options.cwd;
  if (await isProjectSeeded(cwd)) return;

  const seedPath = await resolveSeedModulePath(cwd);
  if (!(await Bun.file(seedPath).exists())) return;

  const write = options.write ?? ((t) => process.stdout.write(t));
  const chromeWrite = (t: string) => write(formatCliChrome(t));
  const ok =
    options.confirmFn !== undefined
      ? await options.confirmFn()
      : await (async () => {
          const value = await confirm({
            message: "Run oke db seed (essential + sample data)?",
            initialValue: true,
          });
          if (isCancel(value)) return false;
          return Boolean(value);
        })();

  if (!ok) {
    chromeWrite("oke db seed: skipped (run `oke db seed` later)\n");
    return;
  }

  const seed =
    options.seedFn ??
    ((projectCwd, env) =>
      runSeed({
        cwd: projectCwd,
        env,
        write: chromeWrite,
        force: true,
        stdinIsTTY: false,
      }));
  const code = await seed(cwd, options.env);
  if (code === 0) {
    await markProjectSeeded(cwd);
  }
}
