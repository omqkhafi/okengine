/**
 * Point `examples/keel/node_modules/okengine` at the monorepo root.
 *
 * Keel cannot use `"okengine": "file:../.."` — Bun hardlinks the entire repo
 * into `.bun/okengine@root`, and macOS refuses to hardlink Cursor plan files
 * under `.cursor/plans` (`com.apple.provenance` → EPERM / ENOENT).
 *
 * Windows directory symlinks need Developer Mode or admin (`EPERM` / `-4048`).
 * Junctions do not, but they require an absolute target.
 */
import { lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/** Relative from `examples/keel/node_modules/okengine` → repo root (POSIX). */
export const OKEENGINE_RELATIVE_LINK = "../../.." as const;

/** Options for {@link linkOkengine}. */
export interface LinkOkengineOptions {
  /** Override `process.platform` (tests). */
  readonly platform?: NodeJS.Platform;
  /** Override {@link symlinkSync} (tests). */
  readonly symlink?: typeof symlinkSync;
}

/**
 * Filesystem link kind for {@link linkOkengine}.
 *
 * @param platform - `process.platform`
 */
export function okengineLinkType(
  platform: NodeJS.Platform = process.platform,
): "junction" | undefined {
  return platform === "win32" ? "junction" : undefined;
}

/**
 * Link target: absolute on Windows junctions, relative elsewhere.
 *
 * @param repoRoot - Absolute monorepo root
 * @param platform - `process.platform`
 */
export function okengineLinkTarget(
  repoRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? repoRoot : OKEENGINE_RELATIVE_LINK;
}

/**
 * Whether two resolved paths name the same directory.
 *
 * @param a - First path
 * @param b - Second path
 * @param platform - `process.platform`
 */
export function sameResolvedPath(
  a: string,
  b: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === "win32") {
    return a.replaceAll("\\", "/").toLowerCase() === b.replaceAll("\\", "/").toLowerCase();
  }
  return a === b;
}

/**
 * Remove a previous `node_modules/okengine` without deleting the repo if
 * the path is a junction / symlink.
 *
 * @param linkPath - `examples/keel/node_modules/okengine`
 */
export function removeOkengineLink(linkPath: string): void {
  try {
    const st = lstatSync(linkPath);
    if (st.isSymbolicLink()) {
      unlinkSync(linkPath);
      return;
    }
  } catch {
    return;
  }
  // Windows junctions can look like directories. `unlink` drops the link;
  // `EISDIR` / `EPERM` means a real leftover folder from a failed install.
  try {
    unlinkSync(linkPath);
  } catch {
    rmSync(linkPath, { recursive: true, force: true });
  }
}

/**
 * Point `keelRoot/node_modules/okengine` at the monorepo root.
 *
 * @param keelRoot - `examples/keel`
 * @param options - Platform / symlink injectables
 */
export function linkOkengine(keelRoot: string, options: LinkOkengineOptions = {}): void {
  const platform = options.platform ?? process.platform;
  const symlink = options.symlink ?? symlinkSync;
  const repoRoot = realpathSync(join(keelRoot, "../.."));
  const linkPath = join(keelRoot, "node_modules/okengine");
  mkdirSync(join(keelRoot, "node_modules"), { recursive: true });

  try {
    if (sameResolvedPath(realpathSync(linkPath), repoRoot, platform)) return;
  } catch {
    /* missing or broken */
  }
  removeOkengineLink(linkPath);

  const type = okengineLinkType(platform);
  const target = okengineLinkTarget(repoRoot, platform);
  try {
    if (type !== undefined) {
      symlink(target, linkPath, type);
    } else {
      symlink(target, linkPath);
    }
  } catch (err) {
    if (platform === "win32" && isLinkPermissionError(err)) {
      throw new Error(
        "oke keel: cannot link okengine (Windows EPERM). Enable Developer Mode, then re-run bun install.",
        { cause: err },
      );
    }
    throw err;
  }
}

/**
 * Whether a Node/Bun filesystem error is a privilege failure.
 *
 * @param err - Caught value
 */
function isLinkPermissionError(err: unknown): boolean {
  if (!err || typeof err !== "object" || !("code" in err)) return false;
  const code = String(err.code);
  return code === "EPERM" || code === "EACCES";
}

if (import.meta.main) {
  linkOkengine(join(import.meta.dir, ".."));
}
