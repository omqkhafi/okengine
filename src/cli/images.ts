/**
 * `oke images pin` — tags → digests in `oke.images.lock`.
 */

import { resolve } from "node:path";
import {
  formatImagesLock,
  pinImages,
  type DigestResolver,
} from "../docker/index.ts";
import { loadOkeConfig, resolveImages } from "./load-config.ts";

/** Options for {@link runImagesPin}. */
export interface ImagesPinOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly out?: string;
  readonly images?: Readonly<Record<string, string>>;
  readonly resolveDigest?: DigestResolver;
  readonly write?: (text: string) => void;
  readonly dryRun?: boolean;
}

/**
 * Pin image tags to digests and write `oke.images.lock`.
 *
 * @param options - Config / resolver
 */
export async function runImagesPin(
  options: ImagesPinOptions = {},
): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const cwd = options.cwd ?? process.cwd();
  let images = options.images;
  if (!images) {
    try {
      const loaded = await loadOkeConfig(cwd, options.configPath);
      images = resolveImages(loaded.config);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }
  try {
    const lock = await pinImages(images, options.resolveDigest);
    const out = resolve(cwd, options.out ?? "oke.images.lock");
    const body = formatImagesLock(lock);
    if (!options.dryRun) await Bun.write(out, body);
    write(`oke images pin: wrote ${out} (${Object.keys(lock.images).length} image(s))\n`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/**
 * CLI entry for `oke images <sub>`.
 *
 * @param args - Args after `images`
 */
export async function imagesCli(args: readonly string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "pin") {
    let configPath: string | undefined;
    let out: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]!;
      if (a === "--config") configPath = rest[++i];
      else if (a === "--out") out = rest[++i];
      else if (a === "--help" || a === "-h") {
        console.log(`oke images pin [--out oke.images.lock]

Resolve image tags to digests and write oke.images.lock.
`);
        return 0;
      }
    }
    return runImagesPin({ configPath, out });
  }
  console.error("Usage: oke images pin");
  return 1;
}
