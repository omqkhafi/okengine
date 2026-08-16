/**
 * `oke doctor` — verify secrets, ports, drivers, tenancy, schema drift.
 */

import { resolve } from "node:path";
import type {
  ConfigEnv,
  DriverRef,
  DriversConfig,
  EnvDriverMap,
  VaultElementConfig,
} from "../config/index.ts";
import { resolveEffectiveDrivers, type EffectiveDriversConfig } from "../config/driver-defaults.ts";
import type { Manifest } from "../manifest/types.ts";
import { APP_PORT, CONSOLE_PORT, MCP_PORT } from "../runtime/types.ts";
import { hasFlag, wantsJson } from "./args.ts";
import { checkManifestPiiAsks } from "./doctor-pii.ts";
import { EXIT_OK, EXIT_RUNTIME } from "./exit.ts";
import { loadManifest, loadOkeConfig } from "./load-config.ts";
import { isPortInUse } from "./ports.ts";
import { schemaFingerprint, readSchemaFingerprint } from "./schema.ts";

export { isPortInUse } from "./ports.ts";

/**
 * `label → merged EnvDriverMap` pairs, in the fixed order shown by
 * {@link formatDriversSummary} / the `drivers` JSON key.
 *
 * @param drivers - Fully-resolved drivers config
 */
function flattenEffectiveDrivers(
  drivers: EffectiveDriversConfig,
): ReadonlyArray<readonly [string, EnvDriverMap]> {
  return [
    ["store.sql", drivers.store.sql],
    ["store.kv", drivers.store.kv],
    ["store.files", drivers.store.files],
    ["signal", drivers.signal],
    ["clock", drivers.clock],
    ["journal", drivers.journal],
    ["vault", drivers.vault],
    ["channel.email", drivers.channel.email],
    ["channel.sms", drivers.channel.sms],
    ["runs", drivers.runs],
  ];
}

/**
 * @param ref - Driver ref (string id, rich `{ driver }` object, or unset)
 */
function driverRefId(ref: DriverRef | undefined): string {
  if (ref === undefined) return "—";
  return typeof ref === "string" ? ref : ref.driver;
}

/**
 * Render the fully-resolved drivers config as aligned text lines — every
 * default plus every override, per env, for a developer whose own
 * `oke.config.ts` only pins a handful of keys.
 *
 * @param drivers - Fully-resolved drivers config
 * @param configEnv - Active env (marked in the active-driver column)
 */
function formatDriversSummary(drivers: EffectiveDriversConfig, configEnv: ConfigEnv): string {
  const rows = flattenEffectiveDrivers(drivers);
  const nameWidth = Math.max(...rows.map(([name]) => name.length));
  const activeWidth = Math.max(...rows.map(([, map]) => driverRefId(map[configEnv]).length));
  const lines = [`drivers (env=${configEnv}):`];
  for (const [name, map] of rows) {
    const active = driverRefId(map[configEnv]);
    const full = `dev=${driverRefId(map.dev)} test=${driverRefId(map.test)} prod=${driverRefId(map.prod)}`;
    lines.push(`  ${name.padEnd(nameWidth)}  ${active.padEnd(activeWidth)}  { ${full} }`);
  }
  return lines.join("\n");
}

/** One doctor finding. */
export interface DoctorFinding {
  readonly code:
    | "missing_secret"
    | "port_conflict"
    | "schema_drift"
    | "db_drift"
    | "tenancy"
    | "driver"
    | "pii_ask"
    | "vault_master_key";
  readonly severity: "error" | "warn";
  readonly message: string;
}

/** Options for {@link runDoctor}. */
export interface DoctorOptions {
  readonly cwd?: string;
  readonly manifestPath?: string;
  readonly manifest?: Manifest;
  /** Secret names expected (from Manifest vault or injection). */
  readonly secrets?: readonly string[];
  /** Env reader (tests). */
  readonly env?: (key: string) => string | undefined;
  /** Ports to probe (defaults O·K·E). */
  readonly ports?: readonly number[];
  /** Inject port-in-use probe (tests). */
  readonly isPortInUse?: (port: number) => Promise<boolean>;
  /** Expected schema fingerprint (tests). */
  readonly expectedSchemaFingerprint?: string;
  /** Current schema fingerprint (tests). */
  readonly currentSchemaFingerprint?: string | null;
  /**
   * Inject domain DB drift probe (tests). When unset, runs drizzle-kit
   * push explain when `drizzle.config.ts` exists.
   */
  readonly detectDbDrift?: () => Promise<{
    readonly drifted: boolean;
    readonly detail?: string;
  }>;
  /** Skip live DB drift probe (default false). */
  readonly skipDbDrift?: boolean;
  /**
   * Inject the `drivers` block directly (tests) — skips loading
   * `oke.config.ts` from disk. When omitted, `oke doctor` best-effort loads
   * `oke.config.ts` from {@link cwd}; a project without one just gets the
   * real, untouched defaults in the drivers summary.
   */
  readonly driversConfig?: DriversConfig;
  /**
   * Inject the `vault` block directly (tests). When omitted, it is read
   * from the same best-effort `oke.config.ts` load as {@link driversConfig}.
   */
  readonly vaultConfig?: VaultElementConfig;
  /**
   * Active {@link ConfigEnv} for the drivers summary. Default: `dev` when
   * `OKE_DOCKER=1` (via {@link env}), else `test`.
   */
  readonly configEnv?: ConfigEnv;
  readonly write?: (text: string) => void;
  /** Write hints / progress (defaults to stderr). */
  readonly writeErr?: (text: string) => void;
  /** Emit only JSON on stdout. */
  readonly json?: boolean;
}

/**
 * Run doctor checks.
 *
 * Exit {@link EXIT_RUNTIME} when any error-severity finding exists;
 * {@link EXIT_OK} otherwise (including warn-only).
 *
 * @param options - Manifest / probes
 */
export async function runDoctor(options: DoctorOptions = {}): Promise<{
  readonly code: number;
  readonly findings: readonly DoctorFinding[];
}> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const writeErr = options.writeErr ?? ((t) => process.stderr.write(t));
  const json = options.json ?? false;
  const cwd = options.cwd ?? process.cwd();
  const findings: DoctorFinding[] = [];

  let manifest = options.manifest;
  if (!manifest) {
    const path = resolve(cwd, options.manifestPath ?? "oke.manifest.json");
    const file = Bun.file(path);
    if (await file.exists()) {
      manifest = await loadManifest(path);
    }
  }

  const env = options.env ?? ((k) => Bun.env[k] ?? process.env[k]);
  const secretNames = options.secrets ?? (manifest?.vault ? Object.keys(manifest.vault) : []);

  // Fully-resolved `drivers.*` — real defaults + every override merged, so
  // the picture is complete even when `oke.config.ts` only pins one key.
  let driversConfig = options.driversConfig;
  let vaultConfig = options.vaultConfig;
  if (driversConfig === undefined || vaultConfig === undefined) {
    try {
      const loaded = (await loadOkeConfig(cwd)).config;
      driversConfig ??= loaded.drivers;
      vaultConfig ??= loaded.vault;
    } catch {
      // No oke.config.ts (or it failed to load) — show real defaults only.
    }
  }
  // Match `bootApplication`: production NODE_ENV → prod; compose → dev; else test.
  const configEnv: ConfigEnv =
    options.configEnv ??
    (env("NODE_ENV") === "production" ? "prod" : env("OKE_DOCKER") === "1" ? "dev" : "test");
  const effectiveDrivers = resolveEffectiveDrivers(driversConfig);

  for (const name of secretNames) {
    const value = env(name);
    if (value === undefined || value.length === 0) {
      const description = manifest?.vault?.[name]?.description;
      findings.push({
        code: "missing_secret",
        severity: "error",
        message: description ? `missing secret ${name}: ${description}` : `missing secret ${name}`,
      });
    }
  }

  // An env-var master key is only as protected as the process environment:
  // it lands in shell history, orchestrator manifests, and crash dumps.
  const usesBuiltinVault =
    vaultConfig !== undefined || driverRefId(effectiveDrivers.vault[configEnv]) === "vault";
  if (
    configEnv === "prod" &&
    usesBuiltinVault &&
    (vaultConfig?.encryption?.masterKey?.kind ?? "env") === "env"
  ) {
    findings.push({
      code: "vault_master_key",
      // Fail closed in prod: an env-sourced master key collapses envelope
      // protection the moment DB + env are stolen together.
      severity: "error",
      message:
        'vault master key comes from an environment variable in prod — set vault.encryption.masterKey = { kind: "kms", keyId } (or use a managed provider) so the key is never readable from the process environment',
    });
  }

  const ports = options.ports ?? [APP_PORT, CONSOLE_PORT, MCP_PORT];
  const probe = options.isPortInUse ?? isPortInUse;
  for (const port of ports) {
    if (await probe(port)) {
      findings.push({
        code: "port_conflict",
        severity: "error",
        message: `port ${port} is already in use`,
      });
    }
  }

  const current =
    options.currentSchemaFingerprint !== undefined
      ? options.currentSchemaFingerprint
      : await readSchemaFingerprint(cwd);
  // Only compare when a schema artefact exists or the caller injects fingerprints.
  if (
    current !== null ||
    options.expectedSchemaFingerprint !== undefined ||
    options.currentSchemaFingerprint !== undefined
  ) {
    const expected =
      options.expectedSchemaFingerprint ?? (await schemaFingerprint(cwd).catch(() => null));
    if (expected !== null && current !== null && expected !== current) {
      findings.push({
        code: "schema_drift",
        severity: "error",
        message:
          "core stub schema drift — run `oke schema generate` (.oke/schema/oke.ts; not domain migrations)",
      });
    } else if (expected !== null && current === null) {
      findings.push({
        code: "schema_drift",
        severity: "error",
        message: ".oke/schema/oke.ts missing — run `oke schema generate` (core/plugin stubs)",
      });
    }
  }

  // Domain schema ↔ live DB — drizzle-kit is the single source of truth.
  if (!options.skipDbDrift) {
    const drizzleConfig = Bun.file(resolve(cwd, "drizzle.config.ts"));
    if (options.detectDbDrift || (await drizzleConfig.exists())) {
      const { detectDbDrift } = await import("./db.ts");
      const probe = options.detectDbDrift ?? (() => detectDbDrift({ cwd }));
      const drift = await probe();
      if (drift.drifted) {
        findings.push({
          code: "db_drift",
          severity: "error",
          message:
            drift.detail ??
            "domain schema differs from the database — run `oke db generate` then `oke db migrate` (or `oke db push` in dev)",
        });
      }
    }
  }

  if (manifest?.tenancy?.isolation) {
    // Structural tenancy check is compile-time; doctor warns when isolation
    // is set but no tenant resolver string is recorded on the Manifest.
    // (Resolver is code — absence of flows is not an error here.)
  }

  if (manifest) {
    findings.push(...checkManifestPiiAsks(manifest));
  }

  const ok = !findings.some((f) => f.severity === "error");
  const code = ok ? EXIT_OK : EXIT_RUNTIME;

  if (json) {
    write(
      `${JSON.stringify({ ok, findings, drivers: { env: configEnv, resolved: effectiveDrivers } }, null, 2)}\n`,
    );
    if (!ok) {
      writeErr("Hint: fix error-severity findings, then re-run oke doctor.\n");
    }
    return { code, findings };
  }

  if (findings.length === 0) {
    write("oke doctor: ok\n");
    write(`${formatDriversSummary(effectiveDrivers, configEnv)}\n`);
    return { code: EXIT_OK, findings };
  }

  write(`oke doctor: ${findings.length} finding(s)\n`);
  for (const f of findings) {
    write(`  [${f.severity}] ${f.code}: ${f.message}\n`);
  }
  write(`${formatDriversSummary(effectiveDrivers, configEnv)}\n`);
  return { code, findings };
}

/**
 * CLI entry for `oke doctor`.
 *
 * @param args - Args after `doctor`
 */
export async function doctorCli(args: readonly string[]): Promise<number> {
  if (hasFlag(args, "--diff", "-d")) {
    const { doctorDiffCli } = await import("./doctor-diff.ts");
    return doctorDiffCli(args);
  }

  let manifestPath: string | undefined;
  let configEnv: ConfigEnv | undefined;
  const json = wantsJson(args);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--manifest" || a === "-m") manifestPath = args[++i];
    else if (a === "--env" || a === "-e") {
      const value = args[++i];
      if (value === "dev" || value === "test" || value === "prod") {
        configEnv = value;
      } else if (value === "local") {
        configEnv = "test";
      } else if (value === "docker") {
        configEnv = "dev";
      }
    } else if (a === "--help" || a === "-h") {
      console.log(`oke doctor [--manifest|-m path] [--env|-e dev|test|prod] [--json|-j]
oke doctor --diff|-d [--before|-b <path> --after|-a <path>] [--base|-B <branch>]

Verify secrets, ports, schema drift, and PII→model egress before serving.
Also prints drivers.* fully resolved (every default + every override merged)
for the active env, from oke.config.ts.

--env   Env to resolve drivers for (default: prod when NODE_ENV=production,
        dev when OKE_DOCKER=1 / \`oke dev\`, else test).
--diff  CI gate: block undeclared contract breaks (Manifest Diff).
        Default baseline is git merge-base (main/master) vs the working
        tree; pass --before/--after for an explicit comparison.

--json  Machine-parseable JSON on stdout; hints on stderr.
`);
      return EXIT_OK;
    }
  }
  const { code } = await runDoctor({ manifestPath, configEnv, json });
  return code;
}
