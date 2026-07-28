/**
 * `oke db` CLI wrappers.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EXIT_OK, EXIT_RUNTIME } from "./exit.ts";
import { dbCli, emitAbstractSchemaPrestep, runDb, runGenerate, runPush } from "./db.ts";

/** Repo public entry — absolute import so temp apps need no install. */
const OKE_INDEX = resolve(import.meta.dir, "../index.ts");
const CONFIG_MOD = resolve(import.meta.dir, "../config/index.ts");

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
