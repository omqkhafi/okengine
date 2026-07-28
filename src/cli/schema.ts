/**
 * `oke schema generate` — core + plugin tables → `schema/oke.ts`.
 */

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Manifest } from "../manifest/types.ts";
import { loadManifest } from "./load-config.ts";

/** Fingerprint file written beside generated schema. */
export const SCHEMA_FINGERPRINT_FILE = "schema/.oke-schema.sha256";

/** Default generated schema path. */
export const SCHEMA_OUT = "schema/oke.ts";

/** Options for {@link runSchemaGenerate}. */
export interface SchemaGenerateOptions {
  readonly cwd?: string;
  readonly manifestPath?: string;
  readonly manifest?: Manifest;
  readonly out?: string;
  /** When true, fail if output would change (CI). */
  readonly check?: boolean;
  readonly write?: (text: string) => void;
  /** Extra table names (plugins / tests). */
  readonly extraTables?: readonly string[];
}

/**
 * Generate `schema/oke.ts` from Manifest store tables + core Console tables.
 *
 * @param options - Manifest / check flag
 */
export async function runSchemaGenerate(options: SchemaGenerateOptions = {}): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const cwd = options.cwd ?? process.cwd();
  let manifest = options.manifest;
  if (!manifest) {
    const path = resolve(cwd, options.manifestPath ?? "oke.manifest.json");
    const file = Bun.file(path);
    if (await file.exists()) manifest = await loadManifest(path);
  }

  const tables = new Set<string>([
    "oke_roles",
    "oke_role_grants",
    "oke_api_keys",
    "oke_overrides",
    "oke_crons",
    "oke_signal_config",
    "oke_console_prefs",
    ...(options.extraTables ?? []),
  ]);
  if (manifest?.stores) {
    for (const store of Object.values(manifest.stores)) {
      for (const t of Object.keys(store.tables ?? {})) tables.add(t);
    }
  }

  const source = emitSchemaSource([...tables].sort());
  const out = resolve(cwd, options.out ?? SCHEMA_OUT);
  const fp = hashSource(source);

  if (options.check) {
    const existing = Bun.file(out);
    if (!(await existing.exists())) {
      write("oke schema generate --check: schema/oke.ts missing\n");
      return 1;
    }
    const current = await existing.text();
    if (hashSource(current) !== fp) {
      write("oke schema generate --check: schema drift\n");
      return 1;
    }
    write("oke schema generate --check: ok\n");
    return 0;
  }

  await mkdir(dirname(out), { recursive: true });
  await Bun.write(out, source);
  await Bun.write(resolve(cwd, SCHEMA_FINGERPRINT_FILE), `${fp}\n`);
  write(`oke schema generate: wrote ${out} (${tables.size} table(s))\n`);
  return 0;
}

/**
 * Fingerprint of the would-be generated schema (for doctor drift).
 *
 * @param cwd - Project root
 * @param manifest - Optional manifest
 */
export async function schemaFingerprint(cwd: string, manifest?: Manifest): Promise<string> {
  const tables = new Set<string>([
    "oke_roles",
    "oke_role_grants",
    "oke_api_keys",
    "oke_overrides",
    "oke_crons",
    "oke_signal_config",
    "oke_console_prefs",
  ]);
  let m = manifest;
  if (!m) {
    const path = resolve(cwd, "oke.manifest.json");
    if (await Bun.file(path).exists()) m = await loadManifest(path);
  }
  if (m?.stores) {
    for (const store of Object.values(m.stores)) {
      for (const t of Object.keys(store.tables ?? {})) tables.add(t);
    }
  }
  return hashSource(emitSchemaSource([...tables].sort()));
}

/**
 * Read the on-disk schema fingerprint, if any.
 *
 * @param cwd - Project root
 */
export async function readSchemaFingerprint(cwd: string): Promise<string | null> {
  const fpFile = Bun.file(resolve(cwd, SCHEMA_FINGERPRINT_FILE));
  if (await fpFile.exists()) {
    return (await fpFile.text()).trim();
  }
  const schema = Bun.file(resolve(cwd, SCHEMA_OUT));
  if (!(await schema.exists())) return null;
  return hashSource(await schema.text());
}

/**
 * CLI entry for `oke schema generate [--check]`.
 *
 * @param args - Args after `schema`
 */
export async function schemaCli(args: readonly string[]): Promise<number> {
  const [sub, ...rest] = args;
  if (sub !== "generate") {
    console.error("Usage: oke schema generate [--check|-c]");
    return 1;
  }
  let check = false;
  let manifestPath: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "--check" || a === "-c") check = true;
    else if (a === "--manifest" || a === "-m") manifestPath = rest[++i];
    else if (a === "--out" || a === "-o") out = rest[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`oke schema generate [--check|-c] [--out|-o schema/oke.ts]

Emit core + plugin tables. Use --check in CI to fail on drift.
`);
      return 0;
    }
  }
  return runSchemaGenerate({ check, manifestPath, out });
}

/**
 * Emit a Drizzle-compatible stub schema module.
 *
 * @param tables - Table names
 */
export function emitSchemaSource(tables: readonly string[]): string {
  const decls = tables
    .map(
      (name) =>
        `/** Generated table handle — wire columns in your app schema. */\nexport const ${camel(name)} = { name: "${name}" } as const;\n`,
    )
    .join("\n");
  return `/**
 * Generated by \`oke schema generate\` — do not edit.
 * Core Console tables + Manifest store tables.
 */

${decls}
export const okeTables = [${tables.map((t) => `"${t}"`).join(", ")}] as const;
`;
}

function hashSource(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
