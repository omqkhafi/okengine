/**
 * `oke docker` — Dockerfile + compose artefacts · `clean` leftover stacks.
 *
 * Default layout is a single production-grade `docker-compose.yml`.
 * Opt into `--split` (per-role files) or `--stack` (`docker-stack.yml`).
 */

import { resolve } from "node:path";
import {
  DEFAULT_DOCKER_DIR,
  DEFAULT_SERVER_BUDGET,
  deriveInfrastructure,
  writeDerivedFiles,
  type ComposeLayout,
  type DeriveOptions,
  type DeriveResult,
} from "../docker/index.ts";
import { dockerCleanCli, dockerCleanHelp } from "./docker-clean.ts";
import { EXIT_OK } from "./exit.ts";
import { loadOkeConfig, loadManifest, manifestHasDurableKv, resolveImages } from "./load-config.ts";

/** Options for {@link runDockerDerive}. */
export interface DockerCliOptions {
  readonly cwd?: string;
  readonly outDir?: string;
  /** Production overlays + resource budget (default true for `oke docker`). */
  readonly prod?: boolean;
  /** Compose layout (default `single`). */
  readonly layout?: ComposeLayout;
  /** Host CPUs for resource apportioning (default 4). */
  readonly serverCpus?: number;
  /** Host RAM GiB for resource apportioning (default 8). */
  readonly serverMemoryGb?: number;
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
  let durableKv = false;
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
        durableKv = manifestHasDurableKv(manifest);
      } else {
        write("oke docker: no oke.config.ts / images — nothing to derive\n");
        return { code: 1 };
      }
    }
  }
  if (!durableKv) {
    for (const name of options.manifestPath
      ? [options.manifestPath]
      : ["oke.manifest.json", "manifest.oke.json"]) {
      const path = resolve(cwd, name);
      if (await Bun.file(path).exists()) {
        durableKv = manifestHasDurableKv(await loadManifest(path));
        break;
      }
    }
  }

  if (!images || Object.keys(images).length === 0) {
    write("oke docker: images map is empty\n");
    return { code: 1 };
  }

  const layout = options.layout ?? "single";
  const prod = options.prod ?? true;
  const serverCpus = options.serverCpus ?? DEFAULT_SERVER_BUDGET.cpus;
  const serverMemoryGb = options.serverMemoryGb ?? DEFAULT_SERVER_BUDGET.memoryGb;

  try {
    const result = deriveInfrastructure({
      images,
      app,
      prod,
      layout,
      serverCpus,
      serverMemoryGb,
      outDir,
      composeDir,
      includeApp: true,
      durableKv,
      ...(options.credentials ? { credentials: options.credentials } : {}),
    });

    if (!options.dryRun) {
      await writeDerivedFiles(result, outDir, { writeStackEnv: false });
    }

    write(`oke docker: wrote ${result.files.length} file(s) → ${composeDir}/\n`);
    for (const f of result.files) write(`  ${composeDir}/${f.path}\n`);
    write(
      `layout: ${layout} · server budget: ${serverCpus} CPU / ${serverMemoryGb} GiB` +
        (prod ? " · production-grade\n" : "\n"),
    );
    write(
      `compose merge order (cwd ${composeDir}/):\n${result.composeFiles.map((f) => `  -f ${f}`).join("\n")}\n`,
    );
    if (layout === "single") {
      write(`(${composeDir}/docker-compose.override.yml is user-owned — never written by oke)\n`);
    } else if (layout === "split") {
      write(`(${composeDir}/compose.override.yml is user-owned — never written by oke)\n`);
    } else {
      write(`(Swarm: docker stack deploy -c ${composeDir}/docker-stack.yml <name>)\n`);
    }
    return { code: 0, result };
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return { code: 1 };
  }
}

/**
 * CLI entry for `oke docker [clean] …` / derive flags.
 *
 * @param args - Args after `docker`
 */
export async function dockerCli(args: readonly string[]): Promise<number> {
  const [head, ...rest] = args;
  if (head === "clean") {
    return dockerCleanCli(rest);
  }

  let prod: boolean | undefined;
  let layout: ComposeLayout | undefined;
  let serverCpus: number | undefined;
  let serverMemoryGb: number | undefined;
  let outDir: string | undefined;
  let configPath: string | undefined;
  let manifestPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--prod" || a === "-p") prod = true;
    else if (a === "--no-prod") prod = false;
    else if (a === "--split") layout = "split";
    else if (a === "--stack") layout = "stack";
    else if (a === "--single") layout = "single";
    else if (a === "--cpus" || a === "--cpu") {
      const raw = args[++i];
      const n = Number(raw);
      if (!raw || !(n > 0)) {
        console.error("oke docker: --cpus requires a positive number");
        return 1;
      }
      serverCpus = n;
    } else if (a === "--memory" || a === "--mem" || a === "--memory-gb") {
      const raw = args[++i];
      const n = Number(raw);
      if (!raw || !(n > 0)) {
        console.error("oke docker: --memory requires a positive GiB number");
        return 1;
      }
      serverMemoryGb = n;
    } else if (a === "--out" || a === "-o") outDir = args[++i];
    else if (a === "--config" || a === "-c") configPath = args[++i];
    else if (a === "--manifest" || a === "-m") manifestPath = args[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`oke docker [options]

Derive production-grade Docker artefacts under docker/ (default).

Layouts (mutually exclusive; default --single):
  --single          docker-compose.yml + Dockerfile (+ .env.local via oke dev)
  --split           compose.yml + compose.<role>.yml (+ compose.prod.yml)
  --stack           docker-stack.yml for docker stack deploy

Server budget (sizes deploy.resources; default 4 CPU / 8 GiB):
  --cpus <n>        host CPUs
  --memory <gib>    host RAM in GiB

Other:
  --prod / -p       production overlays (default on)
  --no-prod         skip readiness / deploy / resource budget
  --out / -o        output directory (default docker)
  --config / -c     oke.config.ts path
  --manifest / -m   Manifest path

Credentials are never written into YAML. PgDog configs land in docker/pgdog/.

${dockerCleanHelp()}`);
      return EXIT_OK;
    } else if (!a.startsWith("-")) {
      console.error(`oke docker: unknown subcommand ${a}`);
      console.error("Run `oke docker --help` for usage.");
      return 1;
    } else {
      console.error(`oke docker: unknown flag ${a}`);
      console.error("Run `oke docker --help` for usage.");
      return 1;
    }
  }
  {
    const layoutFlags = [
      args.includes("--split"),
      args.includes("--stack"),
      args.includes("--single"),
    ].filter(Boolean).length;
    if (layoutFlags > 1) {
      console.error("oke docker: use only one of --single, --split, --stack");
      return 1;
    }
  }
  const { code } = await runDockerDerive({
    prod,
    layout,
    serverCpus,
    serverMemoryGb,
    outDir,
    configPath,
    manifestPath,
  });
  return code;
}
