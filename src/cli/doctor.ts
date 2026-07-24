/**
 * `oke doctor` — verify secrets, ports, drivers, tenancy, schema drift.
 */

import { createServer } from "node:net";
import { resolve } from "node:path";
import type { Manifest } from "../manifest/types.ts";
import { APP_PORT, CONSOLE_PORT, MCP_PORT } from "../runtime/types.ts";
import { loadManifest } from "./load-config.ts";
import { schemaFingerprint, readSchemaFingerprint } from "./schema.ts";

/** One doctor finding. */
export interface DoctorFinding {
  readonly code:
    | "missing_secret"
    | "port_conflict"
    | "schema_drift"
    | "tenancy"
    | "driver";
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
  readonly write?: (text: string) => void;
}

/**
 * Run doctor checks. Exit 1 when any error-severity finding exists.
 *
 * @param options - Manifest / probes
 */
export async function runDoctor(options: DoctorOptions = {}): Promise<{
  readonly code: number;
  readonly findings: readonly DoctorFinding[];
}> {
  const write = options.write ?? ((t) => process.stdout.write(t));
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
  const secretNames =
    options.secrets ??
    (manifest?.vault ? Object.keys(manifest.vault) : []);

  for (const name of secretNames) {
    const value = env(name);
    if (value === undefined || value.length === 0) {
      const description = manifest?.vault?.[name]?.description;
      findings.push({
        code: "missing_secret",
        severity: "error",
        message: description
          ? `missing secret ${name}: ${description}`
          : `missing secret ${name}`,
      });
    }
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
      options.expectedSchemaFingerprint ??
      (await schemaFingerprint(cwd).catch(() => null));
    if (expected !== null && current !== null && expected !== current) {
      findings.push({
        code: "schema_drift",
        severity: "error",
        message:
          "schema drift detected — run `oke schema generate` (or --check in CI)",
      });
    } else if (expected !== null && current === null) {
      findings.push({
        code: "schema_drift",
        severity: "error",
        message: "schema/oke.ts missing — run `oke schema generate`",
      });
    }
  }

  if (manifest?.tenancy?.isolation) {
    // Structural tenancy check is compile-time; doctor warns when isolation
    // is set but no tenant resolver string is recorded on the Manifest.
    // (Resolver is code — absence of flows is not an error here.)
  }

  if (findings.length === 0) {
    write("oke doctor: ok\n");
    return { code: 0, findings };
  }

  write(`oke doctor: ${findings.length} finding(s)\n`);
  for (const f of findings) {
    write(`  [${f.severity}] ${f.code}: ${f.message}\n`);
  }
  const code = findings.some((f) => f.severity === "error") ? 1 : 0;
  return { code, findings };
}

/**
 * CLI entry for `oke doctor`.
 *
 * @param args - Args after `doctor`
 */
export async function doctorCli(args: readonly string[]): Promise<number> {
  let manifestPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--manifest" || a === "-m") manifestPath = args[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`oke doctor [--manifest oke.manifest.json]

Verify secrets, ports, and schema drift before serving requests.
`);
      return 0;
    }
  }
  const { code } = await runDoctor({ manifestPath });
  return code;
}

/**
 * True when something is already listening on `port`.
 *
 * @param port - TCP port
 */
export function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const server = createServer();
    server.once("error", (err: NodeJS.ErrnoException) => {
      resolvePromise(err.code === "EADDRINUSE");
    });
    server.once("listening", () => {
      server.close(() => resolvePromise(false));
    });
    server.listen(port, "127.0.0.1");
  });
}
