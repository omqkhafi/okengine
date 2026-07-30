/**
 * `oke docker` — Dockerfile + per-role compose files.
 */

import { resolve } from "node:path";
import {
  DEFAULT_DOCKER_DIR,
  deriveInfrastructure,
  writeDerivedFiles,
  type DeriveOptions,
  type DeriveResult,
} from "../docker/index.ts";
import { loadOkeConfig, loadManifest, resolveImages } from "./load-config.ts";

/** Options for {@link runDockerDerive}. */
export interface DockerCliOptions {
  readonly cwd?: string;
  readonly outDir?: string;
  readonly prod?: boolean;
  readonly configPath?: string;
  readonly manifestPath?: string;
  readonly write?: (text: string) => void;
  /** Injected images (tests). */
  readonly images?: Readonly<Record<string, string>>;
  /** Injected credentials (tests). */
  readonly credentials?: DeriveOptions["credentials"];
  /** Skip filesystem writes (tests). */
  readonly dryRun?: boolean;
}

/**
 * Derive and write Docker / compose artefacts.
 *
 * @param options - Flags
 * @returns Exit code
 */
export async function runDockerDerive(
  options: DockerCliOptions = {},
): Promise<{ readonly code: number; readonly result?: DeriveResult }> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const cwd = options.cwd ?? process.cwd();
  const composeDirOpt = options.outDir ?? DEFAULT_DOCKER_DIR;
  const outDir = resolve(cwd, composeDirOpt);
  // Relative dir for env_file / build.context rewriting (`.` when out === cwd).
  const composeDir =
    outDir === cwd
      ? "."
      : outDir.startsWith(`${cwd}/`) || outDir.startsWith(`${cwd}\\`)
        ? outDir.slice(cwd.length + 1)
        : ".";

  let images = options.images;
  let app = "app";
  if (!images) {
    try {
      const loaded = await loadOkeConfig(cwd, options.configPath);
      images = resolveImages(loaded.config);
      app = "app";
    } catch {
      if (options.manifestPath) {
        const manifest = await loadManifest(options.manifestPath);
        images = resolveImages(undefined, manifest);
        app = manifest.app;
      } else {
        write("oke docker: no oke.config.ts / images — nothing to derive\n");
        return { code: 1 };
      }
    }
  }

  if (!images || Object.keys(images).length === 0) {
    write("oke docker: images map is empty\n");
    return { code: 1 };
  }

  try {
    const result = deriveInfrastructure({
      images,
      app,
      prod: options.prod ?? false,
      outDir,
      composeDir,
      includeApp: true,
      ...(options.credentials ? { credentials: options.credentials } : {}),
    });

    if (!options.dryRun) {
      await writeDerivedFiles(result, outDir, { writeStackEnv: false });
    }

    const vaultSpec = result.specs.find((s) => s.role === "vault");
    if (vaultSpec) {
      const rel = composeDir === "." ? ".oke/openbao/" : `${composeDir}/../.oke/openbao/`;
      write(
        `oke docker: OpenBao first boot — bring the stack up (e.g. \`oke dev -d\`), and oke ` +
          `will initialize + unseal it once. Root/unseal material stays on the host at ${rel} ` +
          `(0600, gitignored) — back it up; losing it loses every secret permanently.\n`,
      );
    }

    write(`oke docker: wrote ${result.files.length} file(s) → ${composeDir}/\n`);
    for (const f of result.files) write(`  ${composeDir}/${f.path}\n`);
    write(
      `compose merge order (cwd ${composeDir}/):\n${result.composeFiles.map((f) => `  -f ${f}`).join("\n")}\n`,
    );
    write(`(${composeDir}/compose.override.yml is layer 4 — user-owned, never written by oke)\n`);
    return { code: 0, result };
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return { code: 1 };
  }
}

/**
 * CLI entry for `oke docker [--prod|-p] [--out|-o dir]`.
 *
 * @param args - Args after `docker`
 */
export async function dockerCli(args: readonly string[]): Promise<number> {
  let prod = false;
  let outDir: string | undefined;
  let configPath: string | undefined;
  let manifestPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--prod" || a === "-p") prod = true;
    else if (a === "--out" || a === "-o") outDir = args[++i];
    else if (a === "--config" || a === "-c") configPath = args[++i];
    else if (a === "--manifest" || a === "-m") manifestPath = args[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`oke docker [--prod|-p] [--out|-o docker] [--config|-c oke.config.ts]

Derive Dockerfile + compose.<role>.yml under docker/ (default).
--prod is opt-in (never the default). Credentials are never written into YAML.
`);
      return 0;
    }
  }
  const { code } = await runDockerDerive({
    prod,
    outDir,
    configPath,
    manifestPath,
  });
  return code;
}
