/**
 * Consumer-facing `file:` package for local / monorepo create-oke.
 *
 * Linking the monorepo root pulls `workspaces` + `devDependencies` into the
 * scaffold (Console UI, drizzle-zod, …). Bun then warns that RC
 * `drizzle-orm` fails drizzle-zod’s `>=0.36` peer. Stage a publish-shaped
 * tree instead: production `dependencies` only, symlinked `files`.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
    ...(isStringRecord(raw["dependencies"]) ? { dependencies: raw["dependencies"] } : {}),
    ...(isStringRecord(raw["peerDependencies"])
      ? { peerDependencies: raw["peerDependencies"] }
      : {}),
    ...(raw["peerDependenciesMeta"] !== undefined &&
    typeof raw["peerDependenciesMeta"] === "object" &&
    raw["peerDependenciesMeta"] !== null
      ? { peerDependenciesMeta: raw["peerDependenciesMeta"] as Record<string, unknown> }
      : {}),
    ...(raw["engines"] !== undefined ? { engines: raw["engines"] } : {}),
  };

  const stage = localOkengineStageDir();
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  writeFileSync(join(stage, "package.json"), `${JSON.stringify(consumer, null, 2)}\n`, "utf8");

  const entries =
    consumer.files && consumer.files.length > 0
      ? consumer.files
      : ["src", "manifest.v1.schema.json", "AGENTS.md", "README.md"];

  for (const rel of entries) {
    const from = join(root, rel);
    if (!existsSync(from)) continue;
    const to = join(stage, rel);
    mkdirSync(dirname(to), { recursive: true });
    symlinkSync(from, to);
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
