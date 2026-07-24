/**
 * `oke stack` — preview resolved images/tags/ports (writes nothing).
 */

import { formatStackPreview, resolveStack } from "../docker/index.ts";
import { loadOkeConfig, resolveImages } from "./load-config.ts";

/** Options for {@link runStackPreview}. */
export interface StackCliOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly images?: Readonly<Record<string, string>>;
  readonly write?: (text: string) => void;
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
  let images = options.images;
  if (!images) {
    try {
      const loaded = await loadOkeConfig(
        options.cwd ?? process.cwd(),
        options.configPath,
      );
      images = resolveImages(loaded.config);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }
  const rows = resolveStack({ images });
  write(formatStackPreview(rows));
  return 0;
}

/**
 * CLI entry for `oke stack`.
 *
 * @param args - Args after `stack`
 */
export async function stackCli(args: readonly string[]): Promise<number> {
  let configPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--config") configPath = args[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`oke stack [--config oke.config.ts]

Preview resolved images, recipes, and ports. Writes nothing.
`);
      return 0;
    }
  }
  return runStackPreview({ configPath });
}
