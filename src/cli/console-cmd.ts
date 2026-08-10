/**
 * `oke console claim-code` — print the local DX claim mirror from `.oke/claim-code`.
 */

import { resolve } from "node:path";
import {
  claimCodeArtifactPath,
  readClaimCodeArtifact,
} from "../console/server/claim.ts";
import { wantsJson } from "./args.ts";
import { EXIT_OK, EXIT_RUNTIME } from "./exit.ts";

/** Options for {@link consoleClaimCode}. */
export interface ConsoleClaimCodeOptions {
  /** Project root (defaults to `process.cwd()`). */
  readonly cwd?: string;
  /** Clock (injectable for tests). */
  readonly now?: () => number;
  /** Write stdout (defaults to process.stdout). */
  readonly write?: (text: string) => void;
  /** Write hints / errors (defaults to stderr). */
  readonly writeErr?: (text: string) => void;
  /** Emit only JSON on stdout. */
  readonly json?: boolean;
}

/**
 * Print the active setup claim code written by the last Console boot.
 *
 * @param options - Cwd / writers
 * @returns Exit code
 */
export async function consoleClaimCode(options: ConsoleClaimCodeOptions = {}): Promise<number> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const write = options.write ?? ((t) => process.stdout.write(t));
  const writeErr = options.writeErr ?? ((t) => process.stderr.write(t));
  const json = options.json ?? false;
  const now = options.now ?? Date.now;
  const result = readClaimCodeArtifact(cwd, now);

  if (!result.ok) {
    const hint =
      result.reason === "expired"
        ? "Claim code expired (30 min TTL). Restart `oke dev` (or the Console kernel) for a new one."
        : result.reason === "invalid"
          ? `Invalid claim mirror at ${result.path}. Restart Console to mint a fresh code.`
          : `No claim code at ${claimCodeArtifactPath(cwd)}. Start Console with setup open (\`oke dev\`), then retry.`;
    if (json) {
      write(
        `${JSON.stringify({ ok: false, error: result.reason, path: result.path, hint }, null, 2)}\n`,
      );
    } else {
      writeErr(`oke console claim-code: ${hint}\n`);
    }
    return EXIT_RUNTIME;
  }

  const remainingMs = Math.max(0, result.artifact.expiresAt - now());
  if (json) {
    write(
      `${JSON.stringify(
        {
          ok: true,
          code: result.artifact.code,
          expiresAt: result.artifact.expiresAt,
          mintedAt: result.artifact.mintedAt,
          remainingMs,
          path: result.path,
        },
        null,
        2,
      )}\n`,
    );
    return EXIT_OK;
  }

  write(`${result.artifact.code}\n`);
  writeErr(
    `expires in ${Math.ceil(remainingMs / 60_000)} min · mirrored from ${result.path}\n`,
  );
  return EXIT_OK;
}

/**
 * CLI entry for `oke console …`.
 *
 * @param args - Argv after `console`
 */
export async function consoleCli(args: string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === undefined || sub === "--help" || sub === "-h") {
    console.log(`oke console claim-code [--json|-j]

Print the first-admin claim code mirrored to .oke/claim-code by Console boot.
`);
    return EXIT_OK;
  }
  if (sub !== "claim-code") {
    console.error(`Unknown console subcommand: ${sub}`);
    console.error("Run `oke console --help` for usage.");
    return EXIT_RUNTIME;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    console.log(`oke console claim-code [--json|-j]

Print the first-admin claim code mirrored to .oke/claim-code by Console boot.
Requires a running (or recently started) Console with setup still open.
`);
    return EXIT_OK;
  }
  return consoleClaimCode({ json: wantsJson(rest) });
}
