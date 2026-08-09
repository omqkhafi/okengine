/**
 * `oke dev` auto `oke db push` on schema change + opt-out.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDev, type DevOptions, type DevSession, type DevWatchFn } from "./dev.ts";

const sessions: DevSession[] = [];

const STUB_IMAGES = {
  "store.sql": "postgres:16-alpine",
  "store.kv": "redis:7-alpine",
} as const;
const STUB_CREDENTIALS = {
  "store.sql": {
    user: "oke",
    password: "test-password-not-in-yaml",
    database: "oke",
  },
} as const;

function stubCompose(): Pick<
  DevOptions,
  "images" | "credentials" | "composeUp" | "composeHealth" | "composeStop"
> {
  return {
    images: STUB_IMAGES,
    credentials: STUB_CREDENTIALS,
    composeUp: async () => {},
    composeHealth: async () =>
      new Map([
        ["store-sql", "ready"],
        ["store-kv", "ready"],
      ]),
    composeStop: () => {},
  };
}

afterEach(() => {
  for (const s of sessions.splice(0)) s.stop();
});

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await Bun.sleep(20);
  }
}

function controlledWatcher(): {
  watchFs: DevWatchFn;
  change(filename: string): void;
} {
  let listener: Parameters<DevWatchFn>[2] | undefined;
  return {
    watchFs: (_path, _options, next) => {
      listener = next;
      return { close() {} };
    },
    change(filename) {
      if (!listener) throw new Error("watcher not started");
      listener("change", filename);
    },
  };
}

async function scaffoldProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "oke-dev-db-"));
  await mkdir(join(dir, "src"), { recursive: true });
  const configMod = join(import.meta.dir, "../config/index.ts");
  await writeFile(
    join(dir, "oke.config.ts"),
    `import { defineConfig } from ${JSON.stringify(configMod)};
export default defineConfig({
  drivers: { store: { sql: { dev: "postgres", test: "pglite", prod: "postgres" } } },
});
`,
  );
  await writeFile(join(dir, "src", "app.ts"), `export {};\n`);
  await writeFile(
    join(dir, "src", "schema.ts"),
    `import { pgTable, text } from "drizzle-orm/pg-core";
export const entries = pgTable("entries", { id: text("id").primaryKey() });
`,
  );
  await writeFile(
    join(dir, "drizzle.config.ts"),
    `import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  driver: "pglite",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: "memory://" },
});
`,
  );
  return dir;
}

describe("oke dev db auto-push", () => {
  test("schema change triggers dbPush when auto-push is on", async () => {
    const cwd = await scaffoldProject();
    const pushes: string[] = [];
    const watcher = controlledWatcher();
    let resolveReady!: () => void;
    const ready = new Promise<void>((r) => {
      resolveReady = r;
    });

    const result = await runDev({
      cwd,
      ...stubCompose(),
      keepAlive: false,
      dryRun: false,
      appPort: 0,
      consolePort: 0,
      mcpPort: 0,
      silentClaim: true,
      stdinIsTTY: false,
      startApp: async () => ({
        port: 0,
        url: new URL("http://127.0.0.1:9"),
        stop() {},
      }),
      serveConsole: async () => ({
        port: 0,
        stop() {},
      }),
      serveMcp: async () => ({
        port: 0,
        url: new URL("http://127.0.0.1:9"),
        stop() {},
      }),
      regenClient: async () => {},
      dbPush: async () => {
        pushes.push("push");
        return 0;
      },
      onDbAutoPush: () => {
        resolveReady();
      },
      watchFs: watcher.watchFs,
      onReady: async (session) => {
        sessions.push(session);
      },
    });

    expect(result.code).toBe(0);
    // Initial boot triggers one push.
    await Promise.race([ready, Bun.sleep(800)]);
    expect(pushes.length).toBeGreaterThanOrEqual(1);

    const before = pushes.length;
    await writeFile(
      join(cwd, "src", "schema.ts"),
      `import { integer, pgTable, text } from "drizzle-orm/pg-core";
export const entries = pgTable("entries", {
  id: text("id").primaryKey(),
  n: integer("n"),
});
`,
    );
    watcher.change("schema.ts");
    await waitFor(() => pushes.length > before);
    expect(pushes.length).toBeGreaterThan(before);
  });

  test("schema.drizzle.ts change does not re-trigger dbPush", async () => {
    const cwd = await scaffoldProject();
    const pushes: string[] = [];
    const watcher = controlledWatcher();
    let resolveReady!: () => void;
    const ready = new Promise<void>((r) => {
      resolveReady = r;
    });

    const result = await runDev({
      cwd,
      ...stubCompose(),
      keepAlive: false,
      dryRun: false,
      appPort: 0,
      consolePort: 0,
      mcpPort: 0,
      silentClaim: true,
      stdinIsTTY: false,
      startApp: async () => ({
        port: 0,
        url: new URL("http://127.0.0.1:9"),
        stop() {},
      }),
      serveConsole: async () => ({
        port: 0,
        stop() {},
      }),
      serveMcp: async () => ({
        port: 0,
        url: new URL("http://127.0.0.1:9"),
        stop() {},
      }),
      regenClient: async () => {},
      dbPush: async () => {
        pushes.push("push");
        return 0;
      },
      onDbAutoPush: () => {
        resolveReady();
      },
      watchFs: watcher.watchFs,
      onReady: async (session) => {
        sessions.push(session);
      },
    });

    expect(result.code).toBe(0);
    await Promise.race([ready, Bun.sleep(800)]);
    const before = pushes.length;
    expect(before).toBeGreaterThanOrEqual(1);

    // Simulate emit writing schema.drizzle.ts after push — must not loop.
    watcher.change("schema.drizzle.ts");
    watcher.change("src/db/schema.drizzle.ts");
    watcher.change("schema.generated.ts");
    watcher.change("src/schema.generated.ts");
    await Bun.sleep(500);
    expect(pushes.length).toBe(before);
  });

  test("--no-db-push / noDbPush never calls dbPush", async () => {
    const cwd = await scaffoldProject();
    const pushes: string[] = [];
    const watcher = controlledWatcher();

    const result = await runDev({
      cwd,
      ...stubCompose(),
      noDbPush: true,
      keepAlive: false,
      appPort: 0,
      consolePort: 0,
      mcpPort: 0,
      silentClaim: true,
      stdinIsTTY: false,
      startApp: async () => ({
        port: 0,
        url: new URL("http://127.0.0.1:9"),
        stop() {},
      }),
      serveConsole: async () => ({
        port: 0,
        stop() {},
      }),
      serveMcp: async () => ({
        port: 0,
        url: new URL("http://127.0.0.1:9"),
        stop() {},
      }),
      regenClient: async () => {},
      dbPush: async () => {
        pushes.push("push");
        return 0;
      },
      watchFs: watcher.watchFs,
      onReady: async (session) => {
        sessions.push(session);
      },
    });

    expect(result.code).toBe(0);
    await writeFile(
      join(cwd, "src", "schema.ts"),
      `import { pgTable, text } from "drizzle-orm/pg-core";
export const entries = pgTable("entries", { id: text("id").primaryKey(), x: text("x") });
`,
    );
    watcher.change("schema.ts");
    await Bun.sleep(500);
    expect(pushes).toHaveLength(0);
  });
});
