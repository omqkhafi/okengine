/**
 * Unit tests for create-oke argument parsing, transforms, and non-TTY behavior.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  formatCdPath,
  nextStepsText,
  parseArgs,
  run,
  scaffoldArgsFromAnswers,
  scaffoldArgsFromCli,
  shouldPrompt,
  sourceFromArgs,
  type InteractiveAnswers,
} from "./cli.ts";
import { listTemplateFiles, scaffold } from "./scaffold.ts";
import { DEFAULT_TEMPLATE, TEMPLATES, packageRoot, resolveTemplateDir } from "./templates.ts";
import {
  sanitizeProjectName,
  shouldSkipTemplatePath,
  transformConfigForSqlDriver,
  transformPackageJson,
  transformSchemaForSqlDriver,
} from "./transform.ts";

describe("parseArgs", () => {
  test("defaults template to standard", () => {
    const a = parseArgs(["my-app"]);
    expect(a.name).toBe("my-app");
    expect(a.template).toBe("standard");
    expect(a.templateExplicit).toBe(false);
  });

  test("accepts --template and -t", () => {
    expect(parseArgs(["x", "--template", "standard"]).template).toBe("standard");
    expect(parseArgs(["x", "-t", "standard"]).template).toBe("standard");
    expect(parseArgs(["x", "--template=standard"]).template).toBe("standard");
    expect(parseArgs(["x", "--template", "standard"]).templateExplicit).toBe(true);
  });

  test("accepts --sql sqlite|postgres", () => {
    expect(parseArgs(["x"]).sqlDriver).toBe("sqlite");
    expect(parseArgs(["x"]).sqlDriverExplicit).toBe(false);
    expect(parseArgs(["x", "--sql", "postgres"]).sqlDriver).toBe("postgres");
    expect(parseArgs(["x", "--sql=sqlite"]).sqlDriver).toBe("sqlite");
    expect(parseArgs(["x", "--sql", "postgres"]).sqlDriverExplicit).toBe(true);
  });

  test("rejects unknown template, option, and sql", () => {
    expect(() => parseArgs(["x", "--template", "nope"])).toThrow(/template/);
    expect(() => parseArgs(["x", "--unknown"])).toThrow(/unknown option/);
    expect(() => parseArgs(["x", "--sql", "mysql"])).toThrow(/sql/);
  });
});

describe("shouldPrompt", () => {
  test("TTY + no args → interactive", () => {
    expect(shouldPrompt(parseArgs([]), true)).toBe(true);
  });

  test("TTY + name alone → still interactive (confirm name / template)", () => {
    expect(shouldPrompt(parseArgs(["my-app"]), true)).toBe(true);
  });

  test("non-TTY, --yes, or config flags → no prompts", () => {
    expect(shouldPrompt(parseArgs([]), false)).toBe(false);
    expect(shouldPrompt(parseArgs(["my-app"]), false)).toBe(false);
    expect(shouldPrompt(parseArgs(["my-app", "--yes"]), true)).toBe(false);
    expect(shouldPrompt(parseArgs(["my-app", "--template", "standard"]), true)).toBe(false);
    expect(shouldPrompt(parseArgs(["--template", "standard"]), true)).toBe(false);
    expect(shouldPrompt(parseArgs(["--help"]), true)).toBe(false);
  });
});

describe("parseArgs flags", () => {
  test("accepts --yes / --install / --no-install / --no-agents-md", () => {
    expect(parseArgs(["x", "--yes"]).yes).toBe(true);
    expect(parseArgs(["x", "-y"]).yes).toBe(true);
    expect(parseArgs(["x", "--install"]).install).toBe(true);
    expect(parseArgs(["x", "--no-install"]).install).toBe(false);
    expect(parseArgs(["x", "--no-agents-md"]).agentsMd).toBe(false);
    expect(parseArgs(["x"]).agentsMd).toBe(true);
  });

  test("rejects --install with --no-install", () => {
    expect(() => parseArgs(["x", "--install", "--no-install"])).toThrow(/install/);
  });
});

describe("sourceFromArgs", () => {
  test("uses the standard template", () => {
    expect(sourceFromArgs(parseArgs(["x"]))).toEqual({
      kind: "template",
      id: DEFAULT_TEMPLATE,
    });
  });
});

describe("scaffoldArgsFromAnswers ≡ flag-driven", () => {
  test("each --template path matches interactive choice", () => {
    for (const id of TEMPLATES) {
      const answers: InteractiveAnswers = {
        name: "x",
        choice: id,
        installAndRun: false,
        agentsMd: true,
      };
      const fromAnswers = scaffoldArgsFromAnswers(answers);
      const fromFlags = scaffoldArgsFromCli(parseArgs(["x", "--template", id]));
      expect(fromAnswers).toEqual(fromFlags);
      expect(fromAnswers.source).toEqual({ kind: "template", id });
      expect(fromAnswers.sqlDriver).toBe("sqlite");
    }
  });

  test("interactive never opts into --sql postgres (flag-only)", () => {
    const answers: InteractiveAnswers = {
      name: "x",
      choice: "standard",
      installAndRun: false,
      agentsMd: true,
    };
    expect(scaffoldArgsFromAnswers(answers).sqlDriver).toBe("sqlite");
    expect(
      scaffoldArgsFromCli(parseArgs(["x", "--template", "standard", "--sql", "postgres"]))
        .sqlDriver,
    ).toBe("postgres");
  });

  test("only standard is available", () => {
    expect(TEMPLATES).toEqual(["standard"]);
  });
});

describe("transformPackageJson", () => {
  test("rewrites name and okengine file:../.. to installable ref", () => {
    const next = transformPackageJson(
      {
        name: "@oke/template-standard",
        private: true,
        dependencies: {
          okengine: "file:../..",
          zod: "^4.4.3",
        },
      },
      "my-app",
      "0.0.26",
    );
    expect(next.name).toBe("my-app");
    expect(next.version).toBe("0.0.1");
    expect(next.dependencies?.["okengine"]).toBe("0.0.26");
    expect(next.dependencies?.["okengine"]).not.toBe("file:../..");
    expect(next.dependencies?.["zod"]).toBe("^4.4.3");
  });
});

describe("transformSchemaForSqlDriver", () => {
  const sqliteSchema = `import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
export const pings = sqliteTable("pings", {});
`;

  test("postgres swaps dialect imports and table helper", () => {
    const next = transformSchemaForSqlDriver(sqliteSchema, "postgres");
    expect(next).toContain('from "drizzle-orm/pg-core"');
    expect(next).toContain("pgTable(");
    expect(next).not.toContain("sqliteTable");
    expect(next).not.toContain("sqlite-core");
  });

  test("sqlite is idempotent on template sources", () => {
    expect(transformSchemaForSqlDriver(sqliteSchema, "sqlite")).toBe(sqliteSchema);
  });
});

describe("transformConfigForSqlDriver", () => {
  const config = `export default defineConfig({
  drivers: {
    store: {
      sql: {
        local: "sqlite",
        docker: "postgres",
        test: "memory",
        prod: "postgres",
      },
    },
  },
});
`;

  test("postgres pins local/docker/prod and leaves test memory", () => {
    const next = transformConfigForSqlDriver(config, "postgres");
    expect(next).toContain('local: "postgres"');
    expect(next).toContain('docker: "postgres"');
    expect(next).toContain('prod: "postgres"');
    expect(next).toContain('test: "memory"');
  });
});

describe("shouldSkipTemplatePath", () => {
  test("skips node_modules, locks, and monorepo docker test", () => {
    expect(shouldSkipTemplatePath("node_modules/okengine/package.json")).toBe(true);
    expect(shouldSkipTemplatePath("bun.lock")).toBe(true);
    expect(shouldSkipTemplatePath("tests/docker.test.ts")).toBe(true);
    expect(shouldSkipTemplatePath("tests/support.test.ts")).toBe(false);
    expect(shouldSkipTemplatePath("oke.config.ts")).toBe(false);
  });
});

describe("sanitizeProjectName", () => {
  test("lowercases and slugifies", () => {
    expect(sanitizeProjectName("My App")).toBe("my-app");
  });
});

describe("formatCdPath", () => {
  test("keeps absolute paths outside cwd", () => {
    expect(formatCdPath("/tmp/my-app")).toBe("/tmp/my-app");
  });
});

describe("scaffold structure", () => {
  test("each clean template produces its source tree (minus skips)", () => {
    for (const id of TEMPLATES) {
      const dir = mkdtempSync(join(tmpdir(), `create-oke-${id}-`));
      try {
        const templateDir = resolveTemplateDir(id);
        const expected = listTemplateFiles(templateDir);
        const result = scaffold({
          targetDir: join(dir, id),
          name: `app-${id}`,
          source: { kind: "template", id },
        });
        const extras = ["AGENTS.md"];
        if (expected.includes(".env.example")) extras.push(".env.local");
        expect([...result.files].sort()).toEqual([...expected, ...extras].sort());
        expect(result.files).toContain(".gitignore");
        expect(result.files).toContain("README.md");
        expect(result.sqlDriver).toBe("sqlite");
        expect(readFileSync(join(result.targetDir, "AGENTS.md"), "utf8")).toMatch(
          /one law|on\(Trigger\)/i,
        );
        const readme = readFileSync(join(result.targetDir, "README.md"), "utf8");
        expect(readme).toMatch(/oke dev/);
        expect(readme).toMatch(new RegExp(`^# ${id}`, "m"));
        expect(readFileSync(join(result.targetDir, ".gitignore"), "utf8")).toMatch(/node_modules/);
        const pkg = JSON.parse(readFileSync(join(result.targetDir, "package.json"), "utf8")) as {
          name: string;
          dependencies: { okengine: string };
        };
        expect(pkg.name).toBe(`app-${id}`);
        expect(pkg.dependencies.okengine).not.toBe("file:../..");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("standard has full four-applications layout and no business domain", () => {
    const dir = mkdtempSync(join(tmpdir(), "create-oke-standard-assert-"));
    try {
      const result = scaffold({
        targetDir: join(dir, "standard"),
        name: "standard-app",
        source: { kind: "template", id: "standard" },
      });
      for (const path of [
        "src/gates.ts",
        "src/vault.ts",
        "src/channels.ts",
        "src/locales/en.ts",
        "src/locales/ar.ts",
        "src/flows/main/shapes.ts",
        "src/flows/main/signals.ts",
        "src/core.ts",
        "src/schema.decl.ts",
        "src/app.ts",
      ]) {
        expect(result.files).toContain(path);
      }
      const all = result.files
        .filter((f) => f.endsWith(".ts") || f.endsWith(".md"))
        .map((f) => readFileSync(join(result.targetDir, f), "utf8"))
        .join("\n");
      expect(all).not.toMatch(/\bbookings\b|\borders\b|\blinks\b|\bstripe\b/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--sql postgres pins store.sql (abstract schema stays dialect-agnostic)", () => {
    const dir = mkdtempSync(join(tmpdir(), "create-oke-sql-pg-"));
    try {
      const result = scaffold({
        targetDir: join(dir, "pg-app"),
        name: "pg-app",
        source: { kind: "template", id: "standard" },
        sqlDriver: "postgres",
      });
      expect(result.sqlDriver).toBe("postgres");
      // Abstract decl is dialect-agnostic — emit picks pgTable at sync time.
      const decl = readFileSync(join(result.targetDir, "src/schema.decl.ts"), "utf8");
      expect(decl).toContain("store.schema.table(");
      expect(decl).not.toContain("sqliteTable");
      expect(decl).not.toContain("pgTable");
      const drizzle = readFileSync(join(result.targetDir, "drizzle.config.ts"), "utf8");
      expect(drizzle).toContain("OKE_DRIZZLE_DIALECT");
      expect(drizzle).toContain("schema.generated.ts");
      const config = readFileSync(join(result.targetDir, "oke.config.ts"), "utf8");
      expect(config).toMatch(/sql:\s*\{[\s\S]*local:\s*"postgres"/);
      expect(config).toMatch(/sql:\s*\{[\s\S]*docker:\s*"postgres"/);
      expect(config).toMatch(/sql:\s*\{[\s\S]*prod:\s*"postgres"/);
      expect(config).toMatch(/sql:\s*\{[\s\S]*test:\s*"memory"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--no-agents-md skips AGENTS.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "create-oke-no-agents-"));
    try {
      const result = scaffold({
        targetDir: join(dir, "standard"),
        name: "no-agents",
        source: { kind: "template", id: "standard" },
        writeAgentsMd: false,
      });
      expect(result.files).not.toContain("AGENTS.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("non-TTY CLI", () => {
  test("no args + non-TTY → zero prompts, exit 1", async () => {
    const code = await run([], { stdinIsTTY: false, runPostScaffold: false });
    expect(code).toBe(1);
  });

  test("spawned with piped stdin shows no clack prompts", async () => {
    const proc = Bun.spawn(["bun", "run", join(packageRoot(), "src/index.ts")], {
      cwd: packageRoot(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.end();
    const code = await proc.exited;
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    expect(code).toBe(1);
    expect(err).toMatch(/missing <name>/);
    // Clack intro / select chrome must not appear.
    expect(out + err).not.toMatch(/Project name|Start from a worked example/);
    expect(out + err).not.toMatch(/│/);
  });

  test("flag-driven scaffold prints the shared next-steps text", async () => {
    const root = mkdtempSync(join(tmpdir(), "create-oke-flag-"));
    const target = join(root, "flag-app");
    try {
      const code = await run([target, "--template", "standard", "--no-install"], {
        stdinIsTTY: false,
        runPostScaffold: false,
      });
      expect(code).toBe(0);
      expect(readdirSync(target).length).toBeGreaterThan(0);
      expect(existsSync(join(target, "AGENTS.md"))).toBe(true);
      const result = {
        targetDir: target,
        name: "flag-app",
        source: { kind: "template" as const, id: "standard" as const },
        label: "standard",
        okengineDependency: "x",
        files: [],
        sqlDriver: "sqlite" as const,
      };
      expect(nextStepsText(result)).toContain("oke dev");
      expect(nextStepsText(result)).toContain("bun install");
      expect(nextStepsText(result)).toContain("oke.omqkhafi.dev");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
