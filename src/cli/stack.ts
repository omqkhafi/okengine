/**
 * `oke stack` — preview resolved images/tags/ports (writes nothing).
 */

import { formatStackPreview, resolveStack } from "../docker/index.ts";
import { wantsJson } from "./args.ts";
import { EXIT_OK, EXIT_RUNTIME } from "./exit.ts";
import { loadOkeConfig, resolveImages } from "./load-config.ts";

/** Options for {@link runStackPreview}. */
export interface StackCliOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly images?: Readonly<Record<string, string>>;
  readonly write?: (text: string) => void;
  readonly writeErr?: (text: string) => void;
  readonly json?: boolean;
}

/**
 * Print resolved stack preview.
 *
 * @param options - Config / images
 */
export async function runStackPreview(
  options: StackCliOptions = {},
): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const writeErr = options.writeErr ?? ((t) => process.stderr.write(t));
  const json = options.json ?? false;
  let images = options.images;
  if (!images) {
    try {
      const loaded = await loadOkeConfig(
        options.cwd ?? process.cwd(),
        options.configPath,
      );
      images = resolveImages(loaded.config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (json) {
        write(`${JSON.stringify({ ok: false, error: msg }, null, 2)}\n`);
      } else {
        writeErr(`${msg}\n`);
      }
      return EXIT_RUNTIME;
    }
  }
  const rows = resolveStack({ images });
  if (json) {
    write(`${JSON.stringify({ ok: true, rows }, null, 2)}\n`);
    if (rows.length === 0) {
      writeErr("Hint: set images in oke.config.ts — oke stack writes nothing.\n");
    }
    return EXIT_OK;
  }
  write(formatStackPreview(rows));
  return EXIT_OK;
}

/**
 * CLI entry for `oke stack`.
 *
 * @param args - Args after `stack`
 */
export async function stackCli(args: readonly string[]): Promise<number> {
  let configPath: string | undefined;
  const json = wantsJson(args);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--config" || a === "-c") configPath = args[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`oke stack [--config|-c oke.config.ts] [--json|-j]

Preview resolved images, recipes, and ports. Writes nothing.
--json  Machine-parseable JSON on stdout; hints on stderr.
`);
      return EXIT_OK;
    }
  }
  return runStackPreview({ configPath, json });
}
