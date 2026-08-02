/**
 * Discover and tear down leftover `oke-dev-<id>` compose stacks.
 *
 * Identity matches {@link stackAppSlug}: compose project `oke-dev-<6hex>`.
 * Cleanup uses `docker compose -p <project> down -v` (no compose files required).
 */

import { join } from "node:path";
import { stackAppSlug } from "./stack-id.ts";

/** Compose project names created by `oke dev --docker`. */
export const OKE_DEV_PROJECT_RE = /^oke-dev-[0-9a-f]{6}$/;

/** Result of one `docker …` invocation. */
export interface DockerRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Injectable docker CLI runner (tests). */
export type DockerRunner = (args: readonly string[]) => Promise<DockerRunResult>;

/** One container belonging to an OKE compose project. */
export interface OkeContainer {
  readonly id: string;
  readonly name: string;
  readonly service: string;
  readonly state: string;
  readonly project: string;
}

/** One compose project with zero or more containers. */
export interface OkeStack {
  readonly project: string;
  readonly containers: readonly OkeContainer[];
}

/**
 * Compose project name for a project root (`oke-dev-<id>`).
 *
 * @param cwd - Project root
 */
export function composeProjectName(cwd: string): string {
  return `oke-${stackAppSlug(cwd)}`;
}

/**
 * Whether a compose project name is an OKE local stack.
 *
 * @param name - Compose project name
 */
export function isOkeDevProject(name: string): boolean {
  return OKE_DEV_PROJECT_RE.test(name);
}

/**
 * Unique compose projects implied by a container selection.
 *
 * @param containers - Selected containers
 */
export function projectsFromContainerSelection(
  containers: readonly OkeContainer[],
): readonly string[] {
  return [...new Set(containers.map((c) => c.project))].sort();
}

/**
 * True when cwd looks like an okengine app root.
 *
 * @param cwd - Directory to probe
 */
export async function isOkeProjectRoot(cwd: string): Promise<boolean> {
  for (const name of ["oke.config.ts", "oke.config.mts", "oke.config.js"] as const) {
    if (await Bun.file(join(cwd, name)).exists()) return true;
  }
  return false;
}

/**
 * Default runner — `docker` on PATH.
 *
 * @param args - Args after `docker`
 */
export async function defaultDockerRunner(args: readonly string[]): Promise<DockerRunResult> {
  const proc = Bun.spawn(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

/**
 * Discover every `oke-dev-*` compose project on this machine.
 *
 * Sources: `compose ls`, container labels, volume/network name prefixes.
 *
 * @param run - Docker runner
 */
export async function listOkeComposeProjects(
  run: DockerRunner = defaultDockerRunner,
): Promise<readonly OkeStack[]> {
  const projectNames = new Set<string>();

  for (const name of await listComposeProjectNames(run)) {
    if (isOkeDevProject(name)) projectNames.add(name);
  }
  for (const c of await listAllOkeContainers(run)) {
    projectNames.add(c.project);
  }
  for (const name of await listOkeResourceProjectNames(run, "volume")) {
    projectNames.add(name);
  }
  for (const name of await listOkeResourceProjectNames(run, "network")) {
    projectNames.add(name);
  }

  const stacks: OkeStack[] = [];
  for (const project of [...projectNames].sort()) {
    const containers = await listStackContainers(project, run);
    stacks.push({ project, containers });
  }
  return stacks;
}

/**
 * List containers for one compose project.
 *
 * @param project - Compose project name
 * @param run - Docker runner
 */
export async function listStackContainers(
  project: string,
  run: DockerRunner = defaultDockerRunner,
): Promise<readonly OkeContainer[]> {
  const result = await run([
    "ps",
    "-a",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--format",
    "{{json .}}",
  ]);
  if (result.exitCode !== 0) {
    throw new Error(
      `oke docker clean: docker ps failed (${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return parseContainerJsonLines(result.stdout, project);
}

/**
 * Tear down one stack — containers, networks, and named volumes.
 *
 * @param project - Compose project name
 * @param run - Docker runner
 */
export async function downStack(
  project: string,
  run: DockerRunner = defaultDockerRunner,
): Promise<void> {
  if (!isOkeDevProject(project)) {
    throw new Error(`oke docker clean: refusing non-OKE project ${project}`);
  }
  const result = await run(["compose", "-p", project, "down", "-v", "--remove-orphans"]);
  if (result.exitCode !== 0) {
    throw new Error(
      `oke docker clean: docker compose down failed for ${project} (${result.exitCode}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
}

/**
 * Stable selection key for a container (or empty stack sentinel).
 *
 * @param project - Compose project
 * @param containerName - Container name, or empty for volume-only stacks
 */
export function selectionKey(project: string, containerName = ""): string {
  return containerName ? `${project}\0${containerName}` : `${project}\0`;
}

/**
 * Parse selection keys back into projects (and optional container filter).
 *
 * @param keys - Values from multiselect
 * @param stacks - Known stacks (for container lookup)
 */
export function resolveSelection(
  keys: readonly string[],
  stacks: readonly OkeStack[],
): {
  readonly projects: readonly string[];
  readonly containers: readonly OkeContainer[];
} {
  const byProject = new Map(stacks.map((s) => [s.project, s] as const));
  const projects = new Set<string>();
  const containers: OkeContainer[] = [];

  for (const key of keys) {
    const sep = key.indexOf("\0");
    const project = sep === -1 ? key : key.slice(0, sep);
    const containerName = sep === -1 ? "" : key.slice(sep + 1);
    if (!isOkeDevProject(project)) continue;
    projects.add(project);
    const stack = byProject.get(project);
    if (!stack) continue;
    if (!containerName) continue;
    const found = stack.containers.find((c) => c.name === containerName);
    if (found) containers.push(found);
  }

  return { projects: [...projects].sort(), containers };
}

async function listComposeProjectNames(run: DockerRunner): Promise<readonly string[]> {
  const result = await run(["compose", "ls", "-a", "--format", "json"]);
  if (result.exitCode !== 0) {
    // Compose plugin missing or Docker down — other probes may still find leftovers.
    return [];
  }
  const names: string[] = [];
  for (const row of parseJsonRecords(result.stdout)) {
    const name = stringField(row, "Name") ?? stringField(row, "name");
    if (name) names.push(name);
  }
  return names;
}

async function listAllOkeContainers(run: DockerRunner): Promise<readonly OkeContainer[]> {
  const result = await run([
    "ps",
    "-a",
    "--filter",
    "label=com.docker.compose.project",
    "--format",
    "{{json .}}",
  ]);
  if (result.exitCode !== 0) return [];
  const out: OkeContainer[] = [];
  for (const row of parseJsonRecords(result.stdout)) {
    const project =
      labelValue(row, "com.docker.compose.project") ??
      stringField(row, "ComposeProject") ??
      stringField(row, "Project");
    if (!project || !isOkeDevProject(project)) continue;
    out.push(containerFromRow(row, project));
  }
  return out;
}

async function listOkeResourceProjectNames(
  run: DockerRunner,
  kind: "volume" | "network",
): Promise<readonly string[]> {
  const result = await run([kind, "ls", "--format", "{{json .}}"]);
  if (result.exitCode !== 0) return [];
  const names = new Set<string>();
  for (const row of parseJsonRecords(result.stdout)) {
    const name = stringField(row, "Name") ?? stringField(row, "name");
    if (!name) continue;
    const project = projectFromResourceName(name);
    if (project) names.add(project);
  }
  return [...names];
}

/**
 * Extract `oke-dev-<id>` from a volume/network name like `oke-dev-abc123_oke`.
 *
 * @param name - Docker resource name
 */
export function projectFromResourceName(name: string): string | null {
  const m = /^(oke-dev-[0-9a-f]{6})(?:_|$)/.exec(name);
  return m?.[1] ?? null;
}

function parseContainerJsonLines(stdout: string, project: string): readonly OkeContainer[] {
  return parseJsonRecords(stdout).map((row) => containerFromRow(row, project));
}

function containerFromRow(row: Record<string, unknown>, project: string): OkeContainer {
  const names = stringField(row, "Names") ?? stringField(row, "Name") ?? "";
  const name = names.split(",")[0]?.replace(/^\//, "") || names;
  const service =
    labelValue(row, "com.docker.compose.service") ?? stringField(row, "Service") ?? name;
  const id = stringField(row, "ID") ?? stringField(row, "Id") ?? name;
  const state =
    stringField(row, "State") ?? stringField(row, "Status") ?? stringField(row, "state") ?? "";
  return { id, name, service, state, project };
}

function labelValue(row: Record<string, unknown>, key: string): string | null {
  const labels = row.Labels ?? row.labels;
  if (typeof labels === "string") {
    for (const part of labels.split(",")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      if (part.slice(0, eq) === key) return part.slice(eq + 1);
    }
    return null;
  }
  if (labels && typeof labels === "object") {
    const v = (labels as Record<string, unknown>)[key];
    return typeof v === "string" ? v : null;
  }
  return null;
}

function stringField(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Parse Docker `--format json` / `{{json .}}` output (array or NDJSON).
 *
 * @param text - stdout
 */
export function parseJsonRecords(text: string): readonly Record<string, unknown>[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (x): x is Record<string, unknown> => typeof x === "object" && x !== null,
      );
    }
    if (typeof parsed === "object" && parsed !== null) {
      return [parsed as Record<string, unknown>];
    }
  } catch {
    // NDJSON — one object per line
  }
  const out: Record<string, unknown>[] = [];
  for (const line of trimmed.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const row: unknown = JSON.parse(t);
      if (typeof row === "object" && row !== null && !Array.isArray(row)) {
        out.push(row as Record<string, unknown>);
      }
    } catch {
      // skip malformed lines
    }
  }
  return out;
}
