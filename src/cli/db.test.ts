/**
 * `oke db` CLI wrappers.
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EXIT_OK, EXIT_RUNTIME } from "./exit.ts";
import { dbCli, emitAbstractSchemaPrestep, runDb, runGenerate, runPush } from "./db.ts";

/** Repo public entry — absolute import so temp apps need no install. */
const OKE_INDEX = resolve(import.meta.dir, "../index.ts");
const CONFIG_MOD = resolve(import.meta.dir, "../config/index.ts");
const DB_MOD = resolve(import.meta.dir, "./db.ts");

/**
 * Run `oke db generate|migrate` in a fresh Bun process.
 *
 * drizzle-kit's in-process `generate` caches the schema module — a second
 * generate in the same process after rewriting the schema file returns
 * `no_changes`. Real CLI invocations are one process each; the adversarial
 * multi-migration test must match that.
 *
 * Temp projects live under {@link import.meta.dir} so `bunx drizzle-kit`
 * (migrate's default) walks up to the repo `node_modules`.
 */
async function runDbFresh(
  sub: "generate" | "migrate",
  cwd: string,
): Promise<{ readonly code: number; readonly out: string }> {
  const proc = Bun.spawn(
    [
      "bun",
      "-e",
      `import { runDb } from ${JSON.stringify(DB_MOD)};
const cwd = ${JSON.stringify(cwd)};
const prev = process.cwd();
process.chdir(cwd);
try {
  process.exit(await runDb(${JSON.stringify(sub)}, { cwd, skipEmit: true }));
} finally {
  process.chdir(prev);
}
`,
    ],
    { cwd, stdout: "pipe", stderr: "pipe", env: process.env as Record<string, string> },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, out: `${stdout}${stderr}` };
}

async function migrationFolders(drizzleDir: string): Promise<string[]> {
  return (await readdir(drizzleDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

describe("oke db", () => {
  test("help lists subcommands", async () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (msg?: unknown) => {
      lines.push(String(msg ?? ""));
    };
    try {
      const code = await dbCli(["--help"]);
      expect(code).toBe(EXIT_OK);
      expect(lines.join("\n")).toContain("push");
      expect(lines.join("\n")).toContain("generate");
      expect(lines.join("\n")).toContain("migrate");
      expect(lines.join("\n")).toContain("oke schema generate");
    } finally {
      console.log = orig;
    }
  });

  test("push reports ok / no_changes via injectable", async () => {
    const out: string[] = [];
    const code = await runPush("/tmp/drizzle.config.ts", (t) => out.push(t), {
      pushFn: async () => ({ status: "no_changes" }),
      skipEmit: true,
    });
    expect(code).toBe(EXIT_OK);
    expect(out.join("")).toContain("no_changes");
  });

  test("generate surfaces migration_path", async () => {
    const out: string[] = [];
    const code = await runGenerate("/tmp/drizzle.config.ts", (t) => out.push(t), {
      generateFn: async () => ({
        status: "ok",
        migration_path: "/tmp/drizzle/0001_init.sql",
      }),
      skipEmit: true,
    });
    expect(code).toBe(EXIT_OK);
    expect(out.join("")).toContain("0001_init.sql");
  });

  test("missing_hints exits runtime", async () => {
    const code = await runDb("push", {
      pushFn: async () => ({ status: "missing_hints", unresolved: [] }),
      write: () => {},
      skipEmit: true,
    });
    expect(code).toBe(EXIT_RUNTIME);
  });

  test("resolveDrizzleConfigPath uses db.config from oke.config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-db-"));
    await writeFile(
      join(dir, "oke.config.ts"),
      `import { defineConfig } from ${JSON.stringify(CONFIG_MOD)};
export default defineConfig({ db: { config: "custom.drizzle.ts" } });
`,
    );
    const { resolveDrizzleConfigPath } = await import("./db.ts");
    const path = await resolveDrizzleConfigPath(dir);
    expect(path.endsWith("custom.drizzle.ts")).toBe(true);
  });
});

describe("oke db emit — live plugged plugin tables", () => {
  /**
   * End-to-end: real oke().plug() app + schema.decl + runDb("push") must write
   * the plugin's field.* table into schema.generated.ts. Not a unit merge call.
   */
  test("push emits plugin field.* table into schema.generated.ts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-db-plugin-emit-"));
    await mkdir(join(dir, "src"), { recursive: true });

    await writeFile(
      join(dir, "oke.config.ts"),
      `import { defineConfig } from ${JSON.stringify(CONFIG_MOD)};
export default defineConfig({
  drivers: { store: { sql: { local: "sqlite", test: "memory", prod: "postgres" } } },
  db: { declare: "src/schema.decl.ts", generated: "src/schema.generated.ts" },
});
`,
    );

    await writeFile(
      join(dir, "src", "schema.decl.ts"),
      `import { store, field, id } from ${JSON.stringify(OKE_INDEX)};
export const notes = store.schema.table("notes", {
  id: field.text().primaryKey().defaultFn(id),
  title: field.text().notNull(),
});
`,
    );

    await writeFile(
      join(dir, "src", "app.ts"),
      `import { oke, plugin, field, id } from ${JSON.stringify(OKE_INDEX)};

const audit = plugin("audit", { version: "1.0.0" }).table("audit_events", {
  id: field.text().primaryKey().defaultFn(id),
  actorId: field.text().notNull().pii(),
  action: field.text().notNull(),
});

export const app = oke({ name: "plugin-emit" }).plug(audit);
`,
    );

    await writeFile(
      join(dir, "drizzle.config.ts"),
      `import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.generated.ts",
  out: "./drizzle",
  dbCredentials: { url: "file:./local.db" },
});
`,
    );

    const out: string[] = [];
    const code = await runDb("push", {
      cwd: dir,
      write: (t) => out.push(t),
      pushFn: async () => ({ status: "no_changes" }),
      // Real emit path — do not skip; kit is mocked after emit.
    });

    expect(code).toBe(EXIT_OK);
    expect(out.join("")).toMatch(/emitted.*schema\.generated\.ts/);

    const generated = await readFile(join(dir, "src", "schema.generated.ts"), "utf8");
    expect(generated).toContain('sqliteTable("notes"');
    expect(generated).toContain('sqliteTable("audit_events"');
    expect(generated).toContain('text("actor_id")');
    expect(generated).toContain('text("action")');
    expect(generated).toContain(".notNull()");
  });

  test("emitAbstractSchemaPrestep loads plugin tables from app entry alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-db-plugin-only-"));
    await mkdir(join(dir, "src"), { recursive: true });

    await writeFile(
      join(dir, "oke.config.ts"),
      `import { defineConfig } from ${JSON.stringify(CONFIG_MOD)};
export default defineConfig({
  drivers: { store: { sql: { local: "sqlite" } } },
});
`,
    );

    await writeFile(
      join(dir, "src", "app.ts"),
      `import { oke, plugin, field } from ${JSON.stringify(OKE_INDEX)};
export const app = oke({ name: "plugin-only" }).plug(
  plugin("metrics", { version: "1.0.0" }).table("metrics_daily", {
    day: field.text().primaryKey(),
    hits: field.integer().notNull().default(0),
  }),
);
`,
    );

    const { loadOkeConfig } = await import("./load-config.ts");
    const loaded = await loadOkeConfig(dir);
    const emitted = await emitAbstractSchemaPrestep(dir, loaded.config, () => {}, "local");
    expect(emitted).toBe(true);

    const generated = await readFile(join(dir, "src", "schema.generated.ts"), "utf8");
    expect(generated).toContain('sqliteTable("metrics_daily"');
    expect(generated).toContain('integer("hits")');
  });
});

describe("oke db multi-migration catch-up", () => {
  /**
   * Real drizzle-kit generate/migrate through `oke db` — proves multi-file
   * versioned migrations and that re-migrate / environment lag only apply
   * previously-unapplied files (drizzle-kit `__drizzle_migrations` history).
   * The CLI wrapper must not interfere with that bookkeeping.
   */
  test("second migrate skips applied files; lag DB catches up with only the new one", async () => {
    const dir = await mkdtemp(join(import.meta.dir, ".tmp-db-mig-"));
    try {
      await mkdir(join(dir, "src"), { recursive: true });
      await writeFile(
        join(dir, "src", "schema.ts"),
        `import { sqliteTable, text } from "drizzle-orm/sqlite-core";
export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
});
`,
      );
      await writeFile(
        join(dir, "drizzle.config.ts"),
        `import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: "file:./app.db" },
});
`,
      );

      const gen1 = await runDbFresh("generate", dir);
      expect(gen1.code).toBe(EXIT_OK);
      expect(gen1.out).toMatch(/oke db generate: wrote /);
      const migsAfterFirst = await migrationFolders(join(dir, "drizzle"));
      expect(migsAfterFirst.length).toBe(1);
      const initialMig = migsAfterFirst[0];
      expect(initialMig).toBeDefined();
      if (initialMig === undefined) throw new Error("expected initial migration folder");

      const mig1 = await runDbFresh("migrate", dir);
      expect(mig1.code).toBe(EXIT_OK);
      expect(mig1.out).toContain("oke db migrate: applied");

      let db = new Database(join(dir, "app.db"));
      expect(
        db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='notes'").get(),
      ).toBeTruthy();
      let history = db.query("SELECT name FROM __drizzle_migrations ORDER BY id").all() as Array<{
        name: string;
      }>;
      expect(history.map((r) => r.name)).toEqual([initialMig]);
      db.close();

      await writeFile(
        join(dir, "src", "schema.ts"),
        `import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  pinned: integer("pinned").notNull().default(0),
});
`,
      );
      // Distinct timestamp folder names (drizzle-kit uses YYYYMMDDHHmmss).
      await Bun.sleep(1100);

      const gen2 = await runDbFresh("generate", dir);
      expect(gen2.code).toBe(EXIT_OK);
      expect(gen2.out).toMatch(/oke db generate: wrote /);
      const migs = await migrationFolders(join(dir, "drizzle"));
      expect(migs.length).toBe(2);
      const firstMig = migs[0];
      const secondMig = migs[1];
      expect(firstMig).toBeDefined();
      expect(secondMig).toBeDefined();
      if (firstMig === undefined || secondMig === undefined) {
        throw new Error("expected two migration folders");
      }
      expect(firstMig).toBe(initialMig);

      const mig2 = await runDbFresh("migrate", dir);
      expect(mig2.code).toBe(EXIT_OK);

      db = new Database(join(dir, "app.db"));
      history = db.query("SELECT name FROM __drizzle_migrations ORDER BY id").all() as Array<{
        name: string;
      }>;
      expect(history.map((r) => r.name)).toEqual([firstMig, secondMig]);
      const cols = db.query("PRAGMA table_info(notes)").all() as Array<{ name: string }>;
      expect(cols.map((c) => c.name)).toContain("pinned");
      db.close();

      // Idempotent re-migrate: history unchanged, no error.
      const migNoop = await runDbFresh("migrate", dir);
      expect(migNoop.code).toBe(EXIT_OK);
      db = new Database(join(dir, "app.db"));
      const historyNoop = db
        .query("SELECT name FROM __drizzle_migrations ORDER BY id")
        .all() as Array<{ name: string }>;
      expect(historyNoop.map((r) => r.name)).toEqual([firstMig, secondMig]);
      db.close();

      // Staging/prod lag: fresh DB with only the first migration applied,
      // then both files present — catch up applies only the second.
      await rm(join(dir, "app.db"), { force: true });
      const stash = join(dir, "_stash_second");
      await rm(stash, { recursive: true, force: true });
      await rename(join(dir, "drizzle", secondMig), stash);

      const lagFirst = await runDbFresh("migrate", dir);
      expect(lagFirst.code).toBe(EXIT_OK);
      db = new Database(join(dir, "app.db"));
      const lagHist1 = db
        .query("SELECT name FROM __drizzle_migrations ORDER BY id")
        .all() as Array<{ name: string }>;
      expect(lagHist1.map((r) => r.name)).toEqual([firstMig]);
      const lagCols1 = db.query("PRAGMA table_info(notes)").all() as Array<{ name: string }>;
      expect(lagCols1.map((c) => c.name)).not.toContain("pinned");
      db.close();

      await rename(stash, join(dir, "drizzle", secondMig));
      const lagCatchUp = await runDbFresh("migrate", dir);
      expect(lagCatchUp.code).toBe(EXIT_OK);
      db = new Database(join(dir, "app.db"));
      const lagHist2 = db
        .query("SELECT name FROM __drizzle_migrations ORDER BY id")
        .all() as Array<{ name: string }>;
      expect(lagHist2.map((r) => r.name)).toEqual([firstMig, secondMig]);
      const lagCols2 = db.query("PRAGMA table_info(notes)").all() as Array<{ name: string }>;
      expect(lagCols2.map((c) => c.name)).toContain("pinned");
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
