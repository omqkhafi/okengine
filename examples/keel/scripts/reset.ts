/**
 * Wipe keel Compose + local artefacts so the next `oke dev` is a first boot.
 *
 * Writes a fresh `.env.local` from `.env.example` (stack / app defaults).
 * Vault contracts are seeded into the built-in store on `oke db seed`.
 * `oke dev` then regenerates stack passwords and URLs into that file.
 *
 * Run via `bun run reset` / `bun run dev:keel:reset`.
 */

import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Canonical `oke dev` ports — leftover host listeners steal a fresh boot. */
export const KEEL_DEV_PORTS = [6530, 6533, 6535] as const;

/** Gitignored / generated paths removed relative to the keel root. */
export const KEEL_RESET_PATHS = [
  ".oke",
  ".env",
  ".env.local",
  "docker/Dockerfile",
  "docker/pgdog",
  "docker/docker-compose.override.yml",
  "logs",
  "coverage",
] as const;

/** Options for {@link resetKeel}. */
export interface ResetKeelOptions {
  /** Tear down the current project's `oke-dev-*` stack. */
  readonly dockerClean?: (root: string) => Promise<number>;
  /** Log line writer. */
  readonly write?: (text: string) => void;
  /** Exists probe (tests). */
  readonly exists?: (abs: string) => Promise<boolean>;
  /** Recursive remove (tests). */
  readonly remove?: (abs: string) => Promise<void>;
  /** Read `.env.example` (tests). */
  readonly readExample?: (abs: string) => Promise<string | null>;
  /** Write the regenerated `.env.local` (tests). */
  readonly writeEnv?: (abs: string, text: string) => Promise<void>;
  /** PIDs listening on a TCP port (tests). */
  readonly listListenPids?: (port: number) => Promise<readonly number[]>;
  /** Stop a leftover listener (tests). */
  readonly killPid?: (pid: number) => void;
}

/**
 * Whether `abs` exists as a file or directory.
 *
 * @param abs - Absolute path
 */
export async function pathExists(abs: string): Promise<boolean> {
  try {
    await stat(abs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete extra files that exist under `root`.
 *
 * @param root - `examples/keel`
 * @param options - Exists / remove seams
 */
export async function removeKeelExtraFiles(
  root: string,
  options: Pick<ResetKeelOptions, "exists" | "remove"> = {},
): Promise<readonly string[]> {
  const exists = options.exists ?? pathExists;
  const remove = options.remove ?? ((abs) => rm(abs, { recursive: true, force: true }));
  const removed: string[] = [];
  for (const rel of KEEL_RESET_PATHS) {
    const abs = join(root, rel);
    if (!(await exists(abs))) continue;
    await remove(abs);
    removed.push(rel);
  }
  return removed;
}

const ENV_ASSIGN = /^([A-Z][A-Z0-9_]*)=(.*)$/;
const SECTION_HEAD = /^#\s*──\s*(.+?)\s*─+\s*$/;

type EnvSection = {
  readonly title: string;
  readonly keys: readonly string[];
};

/**
 * Parse `# ── title ─` blocks and the `KEY=` names under each.
 *
 * @param example - `.env.example` text
 */
export function parseEnvExampleSections(example: string): readonly EnvSection[] {
  const sections: { title: string; keys: string[] }[] = [];
  let current: { title: string; keys: string[] } | null = null;
  for (const raw of example.split("\n")) {
    const trimmed = raw.trim();
    const head = SECTION_HEAD.exec(trimmed);
    if (head?.[1]) {
      current = { title: head[1].trim(), keys: [] };
      sections.push(current);
      continue;
    }
    const uncommented = trimmed.startsWith("#") ? trimmed.slice(1).trim() : trimmed;
    const match = ENV_ASSIGN.exec(uncommented);
    const key = match?.[1];
    if (!key) continue;
    if (!current) {
      current = { title: "other", keys: [] };
      sections.push(current);
    }
    if (!current.keys.includes(key)) current.keys.push(key);
  }
  return sections;
}

/**
 * Place a stack key that `.env.example` does not list into a nearby band.
 *
 * @param key - Env name
 */
export function extraEnvSectionTitle(key: string): string | null {
  if (key.startsWith("S3_") || key === "OKE_STORE_FILES_URL") {
    return "store.files — object storage (S3)";
  }
  if (
    key.startsWith("SMTP_") ||
    key.startsWith("MP_") ||
    key === "MAILPIT_UI_URL" ||
    key === "OKE_CHANNEL_EMAIL_URL"
  ) {
    return "channel.email — Mailpit (SMTP + UI)";
  }
  if (key.startsWith("OKE_STORE_KV") || key === "REDIS_URL") {
    return "store.kv — Redis";
  }
  if (key.startsWith("OKE_STORE_SQL") || key === "DATABASE_URL") {
    return "store.sql — Postgres";
  }
  if (key === "OKE_PGDOG_URL") {
    return "pgdog — connection pooler (in front of Postgres)";
  }
  if (key.startsWith("MEILI_") || key.startsWith("OKE_STORE_INDEX")) {
    return "store.index — Meilisearch";
  }
  if (key.startsWith("OKE_AI_") || key === "OPENAI_API_KEY" || key === "OLLAMA_HOST") {
    return "AI — llama.cpp (openai-compatible)";
  }
  if (key === "OKE_VAULT_MASTER_KEY" || key.startsWith("OKE_VAULT_")) {
    return "vault — built-in encrypted-at-rest store";
  }
  if (
    key === "PORT" ||
    key.startsWith("OKE_APP") ||
    key.startsWith("OKE_CONSOLE") ||
    key.startsWith("PUBLIC_") ||
    key === "KEEL_WORKSPACE"
  ) {
    return "App / Console";
  }
  if (
    key === "GITHUB_TOKEN" ||
    key === "SLACK_WEBHOOK" ||
    key === "SLACK_BOT" ||
    key === "WEBHOOK_SECRET" ||
    key === "OPENAI_KEY"
  ) {
    return "Keel stubs (no live GitHub / Slack / OpenAI calls)";
  }
  return null;
}

/**
 * Group assignments under `.env.example` section titles.
 *
 * @param values - Name → value (empty values omitted)
 * @param example - Section template
 */
export function formatGroupedEnvLocal(
  values: ReadonlyMap<string, string>,
  example: string,
): string {
  const sections = parseEnvExampleSections(example).map((section) => ({
    title: section.title,
    keys: [...section.keys],
  }));
  const claimed = new Set(sections.flatMap((s) => s.keys));
  for (const key of values.keys()) {
    if (claimed.has(key) || values.get(key) === "") continue;
    const title = extraEnvSectionTitle(key);
    if (!title) {
      let other = sections.find((s) => s.title === "other");
      if (!other) {
        other = { title: "other", keys: [] };
        sections.push(other);
      }
      other.keys.push(key);
      claimed.add(key);
      continue;
    }
    let section = sections.find(
      (s) => s.title === title || s.title.startsWith(title.split(" — ")[0]!),
    );
    if (!section) {
      section = { title, keys: [] };
      sections.push(section);
    }
    section.keys.push(key);
    claimed.add(key);
  }

  const lines: string[] = [
    "# .env.local — written by `bun run dev:keel:reset`",
    "# Grouped like `.env.example`. `oke dev` refreshes stack passwords in place.",
    "",
  ];
  for (const section of sections) {
    const rows = section.keys
      .filter((key, i, all) => all.indexOf(key) === i)
      .map((key) => {
        const value = values.get(key);
        return value !== undefined && value.length > 0 ? `${key}=${value}` : null;
      })
      .filter((row): row is string => row !== null);
    if (rows.length === 0) continue;
    const bar = "─".repeat(Math.max(4, 56 - section.title.length));
    lines.push(`# ── ${section.title} ${bar}`);
    lines.push(...rows);
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n+$/, "\n")}`;
}

/**
 * Uncomment `KEY=value` lines from `.env.example` and keep its section bands.
 * Empty assignments (`KEY=`) are omitted so `oke dev` can mint stack credentials.
 *
 * @param example - `.env.example` text
 */
export function materializeEnvExample(example: string): string {
  const values = new Map<string, string>();
  for (const raw of example.split("\n")) {
    const trimmed = raw.trim();
    const uncommented = trimmed.startsWith("#") ? trimmed.slice(1).trim() : trimmed;
    const match = ENV_ASSIGN.exec(uncommented);
    const key = match?.[1];
    const value = match?.[2];
    if (!key || value === undefined || value.length === 0 || values.has(key)) continue;
    values.set(key, value);
  }
  return formatGroupedEnvLocal(values, example);
}

function parseAssignments(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = ENV_ASSIGN.exec(trimmed);
    const key = match?.[1];
    let value = match?.[2];
    if (!key || value === undefined) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

/**
 * Re-group an existing `.env.local` under `.env.example` section titles.
 * Values stay; only comment bands and key order change.
 *
 * @param root - `examples/keel`
 * @param options - Read / write seams
 */
export async function regroupKeelEnvLocal(
  root: string,
  options: Pick<ResetKeelOptions, "readExample" | "writeEnv"> = {},
): Promise<boolean> {
  const readExample =
    options.readExample ??
    (async (abs) => {
      try {
        return await readFile(abs, "utf8");
      } catch {
        return null;
      }
    });
  const example = await readExample(join(root, ".env.example"));
  if (example === null) return false;
  let local = "";
  try {
    local = await readFile(join(root, ".env.local"), "utf8");
  } catch {
    return false;
  }
  const writeEnv = options.writeEnv ?? ((abs, body) => writeFile(abs, body, "utf8"));
  await writeEnv(join(root, ".env.local"), formatGroupedEnvLocal(parseAssignments(local), example));
  return true;
}

/**
 * Write a starter `.env.local` from `.env.example` when that template exists.
 *
 * @param root - `examples/keel`
 * @param options - Read / write seams
 */
export async function writeKeelEnvLocal(
  root: string,
  options: Pick<ResetKeelOptions, "readExample" | "writeEnv"> = {},
): Promise<boolean> {
  const examplePath = join(root, ".env.example");
  const readExample =
    options.readExample ??
    (async (abs) => {
      try {
        return await readFile(abs, "utf8");
      } catch {
        return null;
      }
    });
  const example = await readExample(examplePath);
  if (example === null) return false;
  const text = materializeEnvExample(example);
  const writeEnv = options.writeEnv ?? ((abs, body) => writeFile(abs, body, "utf8"));
  await writeEnv(join(root, ".env.local"), text);
  return true;
}

/**
 * PIDs with a TCP LISTEN on `port` (lsof). Empty when lsof is missing.
 *
 * @param port - Host port
 */
export async function listListenPids(port: number): Promise<readonly number[]> {
  const proc = Bun.spawn(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) return [];
  return out
    .split("\n")
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

/**
 * SIGTERM leftover listeners on the canonical keel `oke dev` ports.
 *
 * @param options - List / kill / log seams
 */
export async function freeKeelDevPorts(
  options: Pick<ResetKeelOptions, "listListenPids" | "killPid" | "write"> = {},
): Promise<readonly number[]> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const list = options.listListenPids ?? listListenPids;
  const kill = options.killPid ?? ((pid) => process.kill(pid, "SIGTERM"));
  const killed: number[] = [];
  for (const port of KEEL_DEV_PORTS) {
    for (const pid of await list(port)) {
      if (pid === process.pid) continue;
      try {
        kill(pid);
        killed.push(pid);
      } catch {
        // Already gone.
      }
    }
  }
  if (killed.length > 0) {
    write(`oke keel reset: stopped leftover listeners on ${KEEL_DEV_PORTS.join("/")}\n`);
  }
  return killed;
}

/**
 * `oke docker clean --yes` for this project, then remove extra files
 * and write a fresh `.env.local`.
 *
 * @param root - `examples/keel`
 * @param options - Docker / IO seams
 */
export async function resetKeel(root: string, options: ResetKeelOptions = {}): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  write("oke keel reset: stop `bun run dev:keel` if it is still running\n");
  await freeKeelDevPorts(options);
  const dockerClean = options.dockerClean ?? runOkeDockerClean;
  const dockerCode = await dockerClean(root);
  const removed = await removeKeelExtraFiles(root, options);
  if (removed.length === 0) write("oke keel reset: no extra files\n");
  else write(`oke keel reset: removed ${removed.join(", ")}\n`);
  const wroteEnv = await writeKeelEnvLocal(root, options);
  if (wroteEnv) write("oke keel reset: wrote .env.local from .env.example\n");
  if (dockerCode !== 0) return dockerCode;
  write("oke keel reset: ok — next: bun run dev:keel\n");
  return 0;
}

async function runOkeDockerClean(root: string): Promise<number> {
  const local = join(root, "node_modules/.bin/oke");
  const bin = (await pathExists(local)) ? local : "oke";
  const proc = Bun.spawn([bin, "docker", "clean", "--yes"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
}

if (import.meta.main) {
  const code = await resetKeel(join(import.meta.dir, ".."));
  process.exit(code);
}
