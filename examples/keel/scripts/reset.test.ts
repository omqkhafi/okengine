import { describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  KEEL_DEV_PORTS,
  KEEL_RESET_PATHS,
  extraEnvSectionTitle,
  formatGroupedEnvLocal,
  freeKeelDevPorts,
  materializeEnvExample,
  parseEnvExampleSections,
  pathExists,
  regroupKeelEnvLocal,
  removeKeelExtraFiles,
  resetKeel,
} from "./reset.ts";

describe("keel reset", () => {
  test("lists only extra artefacts — never .env.example", () => {
    expect(KEEL_RESET_PATHS).toContain(".oke");
    expect(KEEL_RESET_PATHS).toContain(".env.local");
    expect(KEEL_RESET_PATHS).toContain("docker/Dockerfile");
    expect(KEEL_RESET_PATHS as readonly string[]).not.toContain(".env.example");
    expect(KEEL_RESET_PATHS as readonly string[]).not.toContain("docker/docker-compose.yml");
  });

  test("removes extra files and keeps .env.example", async () => {
    const root = join(tmpdir(), `oke-keel-reset-${Date.now()}`);
    await mkdir(join(root, ".oke"), { recursive: true });
    await mkdir(join(root, "docker"), { recursive: true });
    await writeFile(join(root, ".env.local"), "S3_BUCKET=oke\n");
    await writeFile(join(root, ".env.example"), "keep\n");
    await writeFile(join(root, "docker/Dockerfile"), "FROM scratch\n");
    await writeFile(join(root, "docker/docker-compose.yml"), "name: keep\n");

    const removed = await removeKeelExtraFiles(root);
    expect(removed).toEqual([".oke", ".env.local", "docker/Dockerfile"]);
    expect(await pathExists(join(root, ".env.example"))).toBe(true);
    expect(await pathExists(join(root, "docker/docker-compose.yml"))).toBe(true);
    expect(await pathExists(join(root, ".oke"))).toBe(false);
    expect(await pathExists(join(root, ".env.local"))).toBe(false);
  });

  test("freeKeelDevPorts SIGTERMs leftover listeners on 6530/6533/6535", async () => {
    const killed: number[] = [];
    const logs: string[] = [];
    const pids = await freeKeelDevPorts({
      listListenPids: async (port) => (port === 6530 ? [4242] : []),
      killPid: (pid) => {
        killed.push(pid);
      },
      write: (t) => logs.push(t),
    });
    expect(KEEL_DEV_PORTS).toEqual([6530, 6533, 6535]);
    expect(pids).toEqual([4242]);
    expect(killed).toEqual([4242]);
    expect(logs.some((l) => l.includes("6530/6533/6535"))).toBe(true);
  });

  test("resetKeel still deletes files when docker clean fails", async () => {
    const logs: string[] = [];
    const code = await resetKeel("/tmp/keel-reset-missing", {
      dockerClean: async () => 2,
      write: (t) => logs.push(t),
      exists: async () => false,
      listListenPids: async () => [],
    });
    expect(code).toBe(2);
    expect(logs.some((l) => l.includes("no extra files"))).toBe(true);
    expect(logs.some((l) => l.includes("stop `bun run dev:keel`"))).toBe(true);
  });

  test("materializeEnvExample keeps assigned keys and skips empty ones", () => {
    const text = materializeEnvExample(`
# ── App / Console ───────────────────────────────────────────
# PUBLIC_APP_URL=http://127.0.0.1:6530
# OKE_CONSOLE_SECRET=
# ── Keel stubs ──────────────────────────────────────────────
# GITHUB_TOKEN=ghp_dev
# ── store.sql — Postgres ────────────────────────────────────
DATABASE_URL=postgres://oke:password@127.0.0.1:5432/oke
`);
    expect(text).toContain("# ── App / Console");
    expect(text).toContain("# ── Keel stubs");
    expect(text).toContain("# ── store.sql — Postgres");
    expect(text).toContain("PUBLIC_APP_URL=http://127.0.0.1:6530");
    expect(text).toContain("GITHUB_TOKEN=ghp_dev");
    expect(text).toContain("DATABASE_URL=postgres://oke:password@127.0.0.1:5432/oke");
    expect(text).not.toContain("OKE_CONSOLE_SECRET=");
    expect(text.indexOf("PUBLIC_APP_URL")).toBeLessThan(text.indexOf("GITHUB_TOKEN"));
    expect(text.indexOf("GITHUB_TOKEN")).toBeLessThan(text.indexOf("DATABASE_URL"));
  });

  test("formatGroupedEnvLocal parks stack leftovers in the matching band", () => {
    const example = `
# ── store.kv — Redis ────────────────────────────────────────
# REDIS_URL=redis://:password@127.0.0.1:6379
`;
    const text = formatGroupedEnvLocal(
      new Map([
        ["REDIS_URL", "redis://:x@127.0.0.1:16379"],
        ["OKE_STORE_KV_PASSWORD", "x"],
      ]),
      example,
    );
    expect(extraEnvSectionTitle("OKE_STORE_KV_PASSWORD")).toContain("store.kv");
    expect(extraEnvSectionTitle("OKE_AI_MODEL")).toContain("llama.cpp");
    expect(parseEnvExampleSections(example)[0]?.title).toBe("store.kv — Redis");
    const kv = text.slice(text.indexOf("store.kv"));
    expect(kv).toContain("REDIS_URL=");
    expect(kv).toContain("OKE_STORE_KV_PASSWORD=");
  });

  test("resetKeel writes a fresh .env.local from .env.example", async () => {
    const root = join(tmpdir(), `oke-keel-reset-env-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, ".env.example"),
      "# PUBLIC_APP_URL=http://127.0.0.1:6530\n# KEEL_WORKSPACE=keel\n",
    );
    const logs: string[] = [];
    const code = await resetKeel(root, {
      dockerClean: async () => 0,
      write: (t) => logs.push(t),
      listListenPids: async () => [],
    });
    expect(code).toBe(0);
    const env = await readFile(join(root, ".env.local"), "utf8");
    expect(env).toContain("PUBLIC_APP_URL=http://127.0.0.1:6530");
    expect(env).toContain("KEEL_WORKSPACE=keel");
    expect(logs.some((l) => l.includes("wrote .env.local"))).toBe(true);
  });

  test("regroupKeelEnvLocal keeps values and moves leftovers under the matching band", async () => {
    const root = join(tmpdir(), `oke-keel-regroup-${Date.now()}`);
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, ".env.example"),
      [
        "# ── App / Console ───────────────────────────────────────────",
        "# PORT=6530",
        "# ── store.kv — Redis ────────────────────────────────────────",
        "# REDIS_URL=redis://:password@127.0.0.1:6379",
        "",
      ].join("\n"),
    );
    await writeFile(
      join(root, ".env.local"),
      ["PORT=6530", "REDIS_URL=redis://:secret@127.0.0.1:16379", "OKE_STORE_KV_PASSWORD=secret", ""].join(
        "\n",
      ),
    );
    expect(await regroupKeelEnvLocal(root)).toBe(true);
    const env = await readFile(join(root, ".env.local"), "utf8");
    expect(env.indexOf("App / Console")).toBeLessThan(env.indexOf("store.kv"));
    expect(env.indexOf("PORT=")).toBeLessThan(env.indexOf("REDIS_URL="));
    expect(env.indexOf("REDIS_URL=")).toBeLessThan(env.indexOf("OKE_STORE_KV_PASSWORD="));
    expect(env).toContain("REDIS_URL=redis://:secret@127.0.0.1:16379");
  });
});
