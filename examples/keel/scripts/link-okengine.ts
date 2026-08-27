/**
 * Symlink the monorepo root as `node_modules/okengine`.
 *
 * Keel cannot use `"okengine": "file:../.."` — Bun hardlinks the entire repo
 * into `.bun/okengine@root`, and macOS refuses to hardlink Cursor plan files
 * under `.cursor/plans` (`com.apple.provenance` → EPERM / ENOENT).
 */
import { lstatSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";

const keelRoot = join(import.meta.dir, "..");
const repoRoot = realpathSync(join(keelRoot, "../.."));
const linkPath = join(keelRoot, "node_modules/okengine");
/** Relative from `examples/keel/node_modules/okengine` → repo root. */
const linkTarget = "../../..";

mkdirSync(join(keelRoot, "node_modules"), { recursive: true });

try {
  const st = lstatSync(linkPath);
  if (st.isSymbolicLink() && realpathSync(linkPath) === repoRoot) {
    process.exit(0);
  }
  rmSync(linkPath, { recursive: true, force: true });
} catch {
  /* missing — create below */
}

symlinkSync(linkTarget, linkPath);
