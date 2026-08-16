/**
 * Consumer-facing `file:` package for local / monorepo create-oke.
 *
 * Linking the monorepo root pulls `workspaces` + `devDependencies` into the
 * scaffold (Console UI, drizzle-zod, …). Bun then warns that RC
 * `drizzle-orm` fails drizzle-zod’s `>=0.36` peer. Stage a publish-shaped
 * tree instead:
 *
 * 1. Copy `files` (Bun’s `file:` install drops directory symlinks).
 * 2. Install dependencies **in the stage** — Bun keeps `package.json` as a
 *    symlink into `~/.oke/...`, so the package root is outside the app and
 *    resolution never sees the app’s `node_modules` (peers like `zod` must
 *    live next to the stage too).
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** Fields kept on the staged consumer package.json. */
type ConsumerOkenginePackageJson = {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly license?: string;
  readonly repository?: unknown;
  readonly bin?: unknown;
  readonly files?: readonly string[];
  readonly type?: string;
  readonly sideEffects?: boolean | string[];
  readonly exports?: unknown;
  readonly dependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, unknown>;
  readonly engines?: unknown;
  readonly trustedDependencies?: readonly string[];
};

/**
 * Directory under `~/.oke` where the consumer-facing local package is staged.
 *
 * @returns Absolute stage root
 */
export function localOkengineStageDir(): string {
  return join(homedir(), ".oke", "create-oke", "okengine");
}

/**
 * Build (or refresh) a publish-shaped okengine package and return its
 * installable `file:` dependency string.
 *
 * @param localOkengineRoot - Absolute monorepo / package root
 */
export function materializeLocalOkengineDependency(localOkengineRoot: string): string {
  const root = resolve(localOkengineRoot);
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`create-oke: okengine package.json missing at ${pkgPath}`);
  }

  const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  if (raw["name"] !== "okengine") {
    throw new Error(`create-oke: expected package name "okengine" at ${pkgPath}`);
  }

  const deps = isStringRecord(raw["dependencies"]) ? { ...raw["dependencies"] } : {};
  const peers = isStringRecord(raw["peerDependencies"]) ? raw["peerDependencies"] : {};
  const pins = {
    ...(isStringRecord(raw["devDependencies"]) ? raw["devDependencies"] : {}),
    ...deps,
  };
  // Peers are provided by the app at publish time; for a file: stage whose
  // package root sits outside the app, install them beside the stage too.
  // Prefer monorepo pin versions over peer ranges (`>=1.0.0-rc.0` can resolve
  // a broken drizzle-kit channel build without `drizzle-kit/cli`).
  const stagePeers = Object.fromEntries(
    Object.entries(peers).map(([name, range]) => [name, pins[name] ?? range]),
  );
  const stageDependencies = { ...deps, ...stagePeers };

  const consumer: ConsumerOkenginePackageJson = {
    name: "okengine",
    version: String(raw["version"] ?? "0.0.0"),
    ...(typeof raw["description"] === "string" ? { description: raw["description"] } : {}),
    ...(typeof raw["license"] === "string" ? { license: raw["license"] } : {}),
    ...(raw["repository"] !== undefined ? { repository: raw["repository"] } : {}),
    ...(raw["bin"] !== undefined ? { bin: raw["bin"] } : {}),
    ...(Array.isArray(raw["files"]) ? { files: raw["files"] as string[] } : {}),
    ...(typeof raw["type"] === "string" ? { type: raw["type"] } : {}),
    ...(raw["sideEffects"] !== undefined
      ? { sideEffects: raw["sideEffects"] as boolean | string[] }
      : {}),
    ...(raw["exports"] !== undefined ? { exports: raw["exports"] } : {}),
    ...(Object.keys(stageDependencies).length > 0 ? { dependencies: stageDependencies } : {}),
    ...(raw["engines"] !== undefined ? { engines: raw["engines"] } : {}),
    // Bun blocks native postinstalls unless listed — DuckDB runs queries need it.
    trustedDependencies: ["@duckdb/node-api"],
  };

  const stage = localOkengineStageDir();
  const pkgBody = `${JSON.stringify(consumer, null, 2)}\n`;
  const stagePkgPath = join(stage, "package.json");
  const stageReady =
    existsSync(join(stage, "node_modules", "zod")) &&
    existsSync(join(stage, "node_modules", "drizzle-kit", "cli.mjs")) &&
    existsSync(stagePkgPath) &&
    readFileSync(stagePkgPath, "utf8") === pkgBody;

  if (!stageReady) {
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    writeFileSync(stagePkgPath, pkgBody, "utf8");
  }

  const entries =
    consumer.files && consumer.files.length > 0
      ? consumer.files
      : ["src", "manifest.v1.schema.json", "AGENTS.md", "README.md"];

  for (const rel of entries) {
    const from = join(root, rel);
    if (!existsSync(from)) continue;
    const to = join(stage, rel);
    mkdirSync(dirname(to), { recursive: true });
    // Refresh publish files every call so scaffold always sees current source.
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true, dereference: true });
  }

  if (!stageReady) {
    const install = Bun.spawnSync({
      cmd: ["bun", "install"],
      cwd: stage,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (install.exitCode !== 0) {
      const err = new TextDecoder().decode(install.stderr).trim();
      throw new Error(
        `create-oke: bun install failed in local okengine stage${err ? `\n${err}` : ""}`,
      );
    }
  }

  return `file:${stage}`;
}

/**
 * @param value - Unknown record candidate
 */
function isStringRecord(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}
