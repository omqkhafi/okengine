/**
 * `fs` driver — local filesystem for the files facet (`Bun.file` / `Bun.write`).
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  FilesBucket,
  FilesDriver,
  FilesOpenOptions,
} from "./types.ts";

/**
 * Open a files bucket rooted on the local filesystem.
 *
 * @param options - Bucket name and root directory
 */
export async function openFsBucket(
  options: FilesOpenOptions,
): Promise<FilesBucket> {
  const root = options.root ?? join(tmpdirSafe(), `oke-files-${options.name}`);
  await mkdir(root, { recursive: true });

  function pathFor(key: string): string {
    if (key.includes("..") || key.startsWith("/")) {
      throw new Error(`Invalid object key: ${key}`);
    }
    return join(root, key);
  }

  return {
    driverId: "fs",
    async put(key, data) {
      const path = pathFor(key);
      await mkdir(join(path, ".."), { recursive: true });
      await Bun.write(path, data);
    },
    async get(key) {
      const file = Bun.file(pathFor(key));
      if (!(await file.exists())) return null;
      return new Uint8Array(await file.arrayBuffer());
    },
    async delete(key) {
      const path = pathFor(key);
      const file = Bun.file(path);
      if (!(await file.exists())) return false;
      await rm(path, { force: true });
      return true;
    },
    async list(prefix = "") {
      const glob = new Bun.Glob("**/*");
      const keys: string[] = [];
      for await (const match of glob.scan({ cwd: root, onlyFiles: true })) {
        if (!prefix || match.startsWith(prefix)) keys.push(match);
      }
      return keys.sort();
    },
    async close() {
      /* directory retained for inspection */
    },
  };
}

function tmpdirSafe(): string {
  return process.env.TMPDIR ?? process.env.TMP ?? "/tmp";
}

/** Protocol-named fs driver. */
export const fsDriver: FilesDriver = {
  id: "fs",
  facet: "files",
  open: openFsBucket,
};
