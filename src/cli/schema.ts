/**
 * `oke schema generate` — core + auth + plugin tables → `schema/oke.ts`.
 */

import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  resolveAuthSchema,
  type AuthSchemaOptions,
  type ResolvedAuthModel,
  type ResolvedAuthSchema,
} from "../auth/schema.ts";
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
  /** Auth schema customization (from `gate.auth` / tests). */
  readonly authSchema?: AuthSchemaOptions | false;
}

/**
 * Generate `schema/oke.ts` from Manifest store tables + core auth columns.
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

  const authSchema =
    options.authSchema === false
      ? undefined
      : resolveAuthSchema(options.authSchema ?? loadAuthSchemaFromManifest(manifest));

  const tables = new Set<string>([
    "oke_overrides",
    "oke_crons",
    "oke_signal_config",
    "oke_console_prefs",
    ...(options.extraTables ?? []),
  ]);
  if (authSchema) {
    for (const name of authSchema.tableNames) tables.add(name);
  } else {
    for (const name of [
      "oke_roles",
      "oke_role_grants",
      "oke_api_keys",
      "oke_identities",
      "oke_credentials",
      "oke_sessions",
      "oke_refresh_tokens",
      "oke_verifications",
    ]) {
      tables.add(name);
    }
  }
  if (manifest?.stores) {
    for (const store of Object.values(manifest.stores)) {
      for (const t of Object.keys(store.tables ?? {})) tables.add(t);
    }
  }

  const source = emitSchemaSource([...tables].sort(), authSchema);
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
  let m = manifest;
  if (!m) {
    const path = resolve(cwd, "oke.manifest.json");
    if (await Bun.file(path).exists()) m = await loadManifest(path);
  }
  const authSchema = resolveAuthSchema(loadAuthSchemaFromManifest(m));
  const tables = new Set<string>([
    "oke_overrides",
    "oke_crons",
    "oke_signal_config",
    "oke_console_prefs",
    ...authSchema.tableNames,
  ]);
  if (m?.stores) {
    for (const store of Object.values(m.stores)) {
      for (const t of Object.keys(store.tables ?? {})) tables.add(t);
    }
  }
  return hashSource(emitSchemaSource([...tables].sort(), authSchema));
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

Emit core auth columns + Manifest store tables. Use --check in CI to fail on drift.
`);
      return 0;
    }
  }
  return runSchemaGenerate({ check, manifestPath, out });
}

/**
 * Emit a schema module with real auth columns when resolved.
 *
 * @param tables - Table names
 * @param authSchema - Resolved auth schema (optional)
 */
export function emitSchemaSource(
  tables: readonly string[],
  authSchema?: ResolvedAuthSchema,
): string {
  const byTable = new Map<string, ResolvedAuthModel>();
  if (authSchema) {
    for (const model of Object.values(authSchema.models)) {
      byTable.set(model.tableName, model);
    }
  }

  const decls = tables
    .map((name) => {
      const model = byTable.get(name);
      if (model) return emitAuthTable(model);
      return `/** Generated table handle — wire columns in your app schema. */\nexport const ${camel(name)} = { name: "${name}" } as const;\n`;
    })
    .join("\n");

  return `/**
 * Generated by \`oke schema generate\` — do not edit.
 * Core Gate auth tables + Manifest store tables.
 */

${decls}
export const okeTables = [${tables.map((t) => `"${t}"`).join(", ")}] as const;
`;
}

function emitAuthTable(model: ResolvedAuthModel): string {
  const cols = model.columns
    .map((c) => {
      const extras: string[] = [`sqlType: "${c.sqlType}"`];
      if (c.primary) extras.push("primary: true");
      if (c.required) extras.push("required: true");
      if (c.defaultValue !== undefined) {
        extras.push(`defaultValue: ${JSON.stringify(c.defaultValue)}`);
      }
      return `    ${c.logical}: { name: "${c.sqlName}", ${extras.join(", ")} }`;
    })
    .join(",\n");
  return `/** Auth model \`${model.model}\` → \`${model.tableName}\`. */
export const ${camel(model.tableName)} = {
  name: "${model.tableName}",
  model: "${model.model}",
  columns: {
${cols}
  },
} as const;
`;
}

/**
 * Read optional auth schema customization from Manifest extensions.
 *
 * @param manifest - Loaded Manifest
 */
function loadAuthSchemaFromManifest(manifest: Manifest | undefined): AuthSchemaOptions {
  if (!manifest) return {};
  const ext = (manifest as { authSchema?: AuthSchemaOptions }).authSchema;
  return ext ?? {};
}

function hashSource(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
