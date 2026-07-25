/**
 * `oke images list` — show configured images (writes nothing).
 * `oke images pin` — tags → digests in `oke.images.lock`.
 */

import { resolve } from "node:path";
import {
  formatImagesLock,
  pinImages,
  recipeFor,
  type DigestResolver,
  type ImagesLock,
} from "../docker/index.ts";
import { wantsJson } from "./args.ts";
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from "./exit.ts";
import { loadOkeConfig, resolveImages } from "./load-config.ts";

/** One row in `oke images list`. */
export interface ImagesListRow {
  readonly role: string;
  readonly recipe: string;
  readonly image: string;
  readonly tag: string;
  readonly digest: string;
  /** Human size when known; `-` when not inspected. */
  readonly size: string;
}

/** Options for {@link runImagesList}. */
export interface ImagesListOptions {
  readonly cwd?: string;
  readonly configPath?: string;
  readonly images?: Readonly<Record<string, string>>;
  /** Injected lock (tests); defaults to reading `oke.images.lock`. */
  readonly lock?: ImagesLock | null;
  readonly write?: (text: string) => void;
  readonly writeErr?: (text: string) => void;
  readonly json?: boolean;
}

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
 * List configured images as recipe / image / tag / digest / size (writes nothing).
 *
 * @param options - Config / images
 */
export async function runImagesList(
  options: ImagesListOptions = {},
): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const writeErr = options.writeErr ?? ((t) => process.stderr.write(t));
  const json = options.json ?? false;
  const cwd = options.cwd ?? process.cwd();
  let images = options.images;
  if (!images) {
    try {
      const loaded = await loadOkeConfig(cwd, options.configPath);
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

  const lock =
    options.lock !== undefined
      ? options.lock
      : await readImagesLock(resolve(cwd, "oke.images.lock"));
  const rows = buildImagesListRows(images, lock);

  if (json) {
    write(`${JSON.stringify({ ok: true, images: rows }, null, 2)}\n`);
    if (rows.length === 0) {
      writeErr("Hint: set images in oke.config.ts — oke images list writes nothing.\n");
    }
    return EXIT_OK;
  }

  write(formatImagesList(rows));
  return EXIT_OK;
}

/**
 * Build list rows from role→image map + optional lock digests.
 *
 * @param images - Configured images
 * @param lock - Optional pin lock
 */
export function buildImagesListRows(
  images: Readonly<Record<string, string>>,
  lock: ImagesLock | null,
): readonly ImagesListRow[] {
  return Object.entries(images).map(([role, ref]) => {
    const { image, tag, digestFromRef } = splitImageRef(ref);
    let recipe = "-";
    try {
      recipe = recipeFor(ref).id;
    } catch {
      // Unknown image — still list the row; recipe stays "-".
    }
    const digest =
      lock?.images[role]?.digest ?? digestFromRef ?? "-";
    return {
      role,
      recipe,
      image,
      tag,
      digest,
      size: "-",
    };
  });
}

/**
 * Format the human table for `oke images list`.
 *
 * @param rows - Resolved rows
 */
export function formatImagesList(rows: readonly ImagesListRow[]): string {
  if (rows.length === 0) return "oke images list: no images configured\n";
  const lines = [
    "ROLE            RECIPE     IMAGE                    TAG         DIGEST                     SIZE",
    "--------------  ---------  -----------------------  ----------  -------------------------  ----",
  ];
  for (const r of rows) {
    lines.push(
      `${pad(r.role, 14)}  ${pad(r.recipe, 9)}  ${pad(r.image, 23)}  ${pad(r.tag, 10)}  ${pad(shortDigest(r.digest), 26)}  ${r.size}`,
    );
  }
  return `${lines.join("\n")}\n`;
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
      return EXIT_RUNTIME;
    }
  }
  try {
    const lock = await pinImages(images, options.resolveDigest);
    const out = resolve(cwd, options.out ?? "oke.images.lock");
    const body = formatImagesLock(lock);
    if (!options.dryRun) await Bun.write(out, body);
    write(`oke images pin: wrote ${out} (${Object.keys(lock.images).length} image(s))\n`);
    return EXIT_OK;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return EXIT_RUNTIME;
  }
}

/**
 * CLI entry for `oke images <sub>`.
 *
 * @param args - Args after `images`
 */
export async function imagesCli(args: readonly string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub === "list") {
    let configPath: string | undefined;
    const json = wantsJson(rest);
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]!;
      if (a === "--config" || a === "-c") configPath = rest[++i];
      else if (a === "--help" || a === "-h") {
        console.log(`oke images list [--config|-c oke.config.ts] [--json|-j]

List configured images as recipe / image / tag / digest / size. Writes nothing.
Digest comes from oke.images.lock when present; size is "-" until inspected.
--json  Machine-parseable JSON on stdout; hints on stderr.
`);
        return EXIT_OK;
      }
    }
    return runImagesList({ configPath, json });
  }
  if (sub === "pin") {
    let configPath: string | undefined;
    let out: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]!;
      if (a === "--config" || a === "-c") configPath = rest[++i];
      else if (a === "--out" || a === "-o") out = rest[++i];
      else if (a === "--help" || a === "-h") {
        console.log(`oke images pin [--out|-o oke.images.lock] [--config|-c path]

Resolve image tags to digests and write oke.images.lock.
`);
        return EXIT_OK;
      }
    }
    return runImagesPin({ configPath, out });
  }
  console.error("Usage: oke images list|pin");
  return EXIT_USAGE;
}

function splitImageRef(ref: string): {
  image: string;
  tag: string;
  digestFromRef: string | null;
} {
  const at = ref.indexOf("@");
  if (at !== -1) {
    const left = ref.slice(0, at);
    const digest = ref.slice(at + 1);
    const colon = left.lastIndexOf(":");
    if (colon > left.lastIndexOf("/")) {
      return {
        image: left.slice(0, colon),
        tag: left.slice(colon + 1),
        digestFromRef: digest,
      };
    }
    return { image: left, tag: "-", digestFromRef: digest };
  }
  const colon = ref.lastIndexOf(":");
  if (colon > ref.lastIndexOf("/")) {
    return {
      image: ref.slice(0, colon),
      tag: ref.slice(colon + 1),
      digestFromRef: null,
    };
  }
  return { image: ref, tag: "latest", digestFromRef: null };
}

async function readImagesLock(path: string): Promise<ImagesLock | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as ImagesLock;
  } catch {
    return null;
  }
}

function shortDigest(digest: string): string {
  if (digest === "-") return digest;
  if (digest.startsWith("sha256:") && digest.length > 19) {
    return `${digest.slice(0, 19)}…`;
  }
  return digest;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
