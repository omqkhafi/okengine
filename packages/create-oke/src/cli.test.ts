/**
 * Unit tests for create-oke argument parsing, transforms, and non-TTY behavior.
 */

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WIZARD_BACK,
  aiSetupProviderFor,
  defaultsBranchOptions,
  formatCdPath,
  nextStepsText,
  parseArgs,
  run,
  scaffoldArgsFromAnswers,
  scaffoldArgsFromCli,
  shouldPrompt,
  sourceFromArgs,
  withBackOption,
  type InteractiveAnswers,
} from "./cli.ts";
import {
  createDefaultsPath,
  readCreateDefaults,
  toCreateDefaults,
  writeCreateDefaults,
} from "./create-defaults.ts";
import { pinsDockerReady, pinsLocalOnly, recommendedDefaults } from "./drivers-catalog.ts";
import { listTemplateFiles, scaffold, targetDirectoryBlockReason } from "./scaffold.ts";
import {
  DEFAULT_TEMPLATE,
  TEMPLATE_DEFAULT_MODE,
  TEMPLATES,
  packageRoot,
  resolveTemplateDir,
} from "./templates.ts";
import {
  applyCreateAnswers,
  sanitizeProjectName,
  shouldSkipTemplatePath,
  transformConfigForSqlDriver,
  transformPackageJson,
  transformSchemaForSqlDriver,
} from "./transform.ts";

describe("defaultsBranchOptions", () => {
  test("hides reuse when no previous settings exist", () => {
    const values = defaultsBranchOptions(false).map((o) => o.value);
    expect(values).toEqual(["recommended", "customize"]);
  });

  test("offers reuse when previous settings exist", () => {
    const values = defaultsBranchOptions(true).map((o) => o.value);
    expect(values).toEqual(["recommended", "reuse", "customize"]);
  });
});

describe("parseArgs", () => {
  test("defaults template to standard", () => {
    const a = parseArgs(["my-app"]);
    expect(a.name).toBe("my-app");
    expect(a.template).toBe("standard");
    expect(a.templateExplicit).toBe(false);
  });

  test("accepts --template and -t", () => {
    expect(parseArgs(["x", "--template", "standard"]).template).toBe("standard");
    expect(parseArgs(["x", "-t", "advanced"]).template).toBe("advanced");
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

function recommendedAnswers(overrides: Partial<InteractiveAnswers> = {}): InteractiveAnswers {
  return {
    name: "x",
    choice: "standard",
    installAndRun: false,
    agentsMd: true,
    createDefaults: undefined,
    aiApply: null,
    ...overrides,
  };
}

describe("scaffoldArgsFromAnswers ≡ flag-driven", () => {
  test("each --template path matches interactive choice (recommended)", () => {
    for (const id of TEMPLATES) {
      const answers = recommendedAnswers({ choice: id });
      const fromAnswers = scaffoldArgsFromAnswers(answers);
      const fromFlags = scaffoldArgsFromCli(parseArgs(["x", "--template", id]));
      expect(fromAnswers.name).toBe(fromFlags.name);
      expect(fromAnswers.targetDir).toBe(fromFlags.targetDir);
      expect(fromAnswers.source).toEqual(fromFlags.source);
      expect(fromAnswers.agentsMd).toBe(fromFlags.agentsMd);
      expect(fromAnswers.sqlDriver).toBe(fromFlags.sqlDriver);
      expect(fromAnswers.createDefaults).toBeUndefined();
    }
  });

  test("interactive never opts into --sql postgres without override", () => {
    expect(scaffoldArgsFromAnswers(recommendedAnswers()).sqlDriver).toBe("sqlite");
    expect(
      scaffoldArgsFromCli(parseArgs(["x", "--template", "standard", "--sql", "postgres"]))
        .sqlDriver,
    ).toBe("postgres");
  });

  test("standard and advanced are available", () => {
    expect(TEMPLATES).toEqual(["standard", "advanced"]);
  });
});

describe("defaultsBranchOptions template hints", () => {
  test("reuse hint names the selected template", () => {
    const reuse = defaultsBranchOptions(true, "advanced").find((o) => o.value === "reuse");
    expect(reuse?.hint).toContain("advanced");
  });
});

describe("parseArgs AI flags", () => {
  test("accepts --ai / --no-ai / --ai skip", () => {
    expect(parseArgs(["x"]).ai).toBe("prompt");
    expect(parseArgs(["x", "--ai"]).ai).toBe("force");
    expect(parseArgs(["x", "--no-ai"]).ai).toBe("skip");
    expect(parseArgs(["x", "--ai", "skip"]).ai).toBe("skip");
    expect(parseArgs(["x", "--ai=skip"]).ai).toBe("skip");
  });
});

describe("wizard ← Back", () => {
  test("withBackOption appends sentinel when allowed", () => {
    const base = [{ value: "memory", label: "memory" }];
    expect(withBackOption(base, false)).toEqual(base);
    const withBack = withBackOption(base, true);
    expect(withBack.at(-1)).toEqual({ value: WIZARD_BACK, label: "Back" });
    expect(WIZARD_BACK).toBe("__back__");
  });
});

describe("aiSetupProviderFor", () => {
  test("prefers ollama when docker is ollama even if local is mock", () => {
    expect(
      aiSetupProviderFor("mock", {
        local: "mock",
        docker: "ollama",
        test: "mock",
        prod: "ollama",
      }),
    ).toBe("ollama");
  });

  test("keeps local ollama", () => {
    expect(
      aiSetupProviderFor("ollama", {
        local: "ollama",
        docker: "anthropic",
        test: "mock",
        prod: "anthropic",
      }),
    ).toBe("ollama");
  });
});

describe("interactive branches", () => {
  test("recommended → no createDefaults, no AI setup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oke-rec-"));
    rmSync(dir, { recursive: true, force: true });
    try {
      const code = await run([dir], {
        stdinIsTTY: true,
        runPostScaffold: false,
        ask: async () => recommendedAnswers({ name: dir }),
      });
      expect(code).toBe(0);
      const config = readFileSync(join(dir, "oke.config.ts"), "utf8");
      expect(config).toContain('local: "sqlite"');
      expect(readFileSync(join(dir, ".oke", "mode"), "utf8").trim()).toBe("local");
      expect(existsSync(join(dir, "src", "flows", "notes", "index.ts"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("recommended advanced → docker mode + advanced Notes flows", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oke-rec-adv-"));
    rmSync(dir, { recursive: true, force: true });
    try {
      const code = await run([dir], {
        stdinIsTTY: true,
        runPostScaffold: false,
        ask: async () => recommendedAnswers({ name: dir, choice: "advanced" }),
      });
      expect(code).toBe(0);
      expect(readFileSync(join(dir, ".oke", "mode"), "utf8").trim()).toBe("docker");
      const notes = readFileSync(join(dir, "src", "flows", "notes", "index.ts"), "utf8");
      expect(notes).toContain('name: "notes.digest"');
      expect(notes).toContain('name: "notes.attach"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reuse previous settings round-trip", async () => {
    const home = mkdtempSync(join(tmpdir(), "oke-reuse-"));
    const path = createDefaultsPath(home);
    const base = recommendedDefaults("local-only");
    const saved = {
      ...base,
      drivers: {
        ...base.drivers,
        store: {
          ...base.drivers.store,
          sql: {
            local: "libsql",
            docker: "postgres",
            test: "memory",
            prod: "postgres",
          },
        },
      },
    };
    writeCreateDefaults(saved, path);

    const dir = mkdtempSync(join(tmpdir(), "oke-reuse-app-"));
    rmSync(dir, { recursive: true, force: true });

    try {
      const code = await run([dir], {
        stdinIsTTY: true,
        runPostScaffold: false,
        ask: async () =>
          recommendedAnswers({
            name: dir,
            createDefaults: saved,
            aiApply: null,
          }),
      });
      expect(code).toBe(0);
      const config = readFileSync(join(dir, "oke.config.ts"), "utf8");
      expect(config).toContain('local: "libsql"');
      const templateConfig = readFileSync(
        join(resolveTemplateDir("standard"), "oke.config.ts"),
        "utf8",
      );
      expect(() => applyCreateAnswers(templateConfig, saved)).not.toThrow();
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("customize answers applied + persistence write", async () => {
    const home = mkdtempSync(join(tmpdir(), "oke-custom-"));
    const path = createDefaultsPath(home);
    const customized = toCreateDefaults({
      template: "standard",
      profile: "local-only",
      drivers: {
        store: {
          sql: pinsLocalOnly("pglite", "postgres", "memory"),
          kv: pinsLocalOnly("memory", "redis", "memory"),
          files: pinsLocalOnly("fs", "s3", "memory"),
          index: null,
        },
        signal: pinsLocalOnly("memory", "redis", "memory"),
        clock: pinsLocalOnly("memory", "file", "frozen"),
        vault: pinsLocalOnly("env", "openbao", "memory"),
        channel: { email: pinsLocalOnly("console", "smtp", "console") },
        ai: null,
      },
      ai: { enabled: false, provider: null, driver: null },
    });

    const dir = mkdtempSync(join(tmpdir(), "oke-custom-app-"));
    rmSync(dir, { recursive: true, force: true });

    try {
      const code = await run([dir], {
        stdinIsTTY: true,
        runPostScaffold: false,
        ask: async (partial) => {
          writeCreateDefaults(customized, path);
          return recommendedAnswers({
            name: dir,
            createDefaults: customized,
            agentsMd: partial.agentsMd ?? true,
          });
        },
      });
      expect(code).toBe(0);
      expect(existsSync(path)).toBe(true);
      expect(readCreateDefaults(path)?.drivers.store.sql.local).toBe("pglite");
      expect(readFileSync(join(dir, "oke.config.ts"), "utf8")).toContain('local: "pglite"');
      // local-only profile → seed oke dev mode so the prompt is not repeated.
      expect(readFileSync(join(dir, ".oke", "mode"), "utf8").trim()).toBe("local");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("docker-ready profile seeds .oke/mode as docker", async () => {
    const customized = toCreateDefaults({
      template: "advanced",
      profile: "docker-ready",
      drivers: {
        store: {
          sql: pinsDockerReady("sqlite", "postgres", "memory"),
          kv: pinsLocalOnly("memory", "redis", "memory"),
          files: pinsLocalOnly("fs", "s3", "memory"),
          index: null,
        },
        signal: pinsLocalOnly("memory", "redis", "memory"),
        clock: pinsLocalOnly("memory", "file", "frozen"),
        vault: pinsLocalOnly("env", "openbao", "memory"),
        channel: { email: pinsLocalOnly("console", "smtp", "console") },
        ai: null,
      },
      ai: { enabled: false, provider: null, driver: null },
    });
    const dir = mkdtempSync(join(tmpdir(), "oke-docker-mode-"));
    rmSync(dir, { recursive: true, force: true });
    try {
      const code = await run([dir], {
        stdinIsTTY: true,
        runPostScaffold: false,
        ask: async () =>
          recommendedAnswers({
            name: dir,
            createDefaults: customized,
            aiApply: null,
          }),
      });
      expect(code).toBe(0);
      expect(readFileSync(join(dir, ".oke", "mode"), "utf8").trim()).toBe("docker");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("non-TTY --yes stays zero-prompt recommended", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oke-yes-"));
    rmSync(dir, { recursive: true, force: true });
    try {
      let askCalled = false;
      const code = await run([dir, "--yes", "--no-install", "--no-ai"], {
        stdinIsTTY: false,
        runPostScaffold: false,
        ask: async () => {
          askCalled = true;
          return recommendedAnswers({ name: dir });
        },
      });
      expect(code).toBe(0);
      expect(askCalled).toBe(false);
      const config = readFileSync(join(dir, "oke.config.ts"), "utf8");
      expect(config).toContain('local: "sqlite"');
      expect(config).not.toMatch(/\bai:\s*\{/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
        const extras = ["AGENTS.md", ".oke/mode"];
        if (expected.includes(".env.example")) extras.push(".env.local");
        expect([...result.files].sort()).toEqual([...expected, ...extras].sort());
        expect(readFileSync(join(result.targetDir, ".oke", "mode"), "utf8").trim()).toBe(
          TEMPLATE_DEFAULT_MODE[id],
        );
        expect(result.files).toContain(".gitignore");
        expect(result.files).toContain("README.md");
        expect(result.files).toContain(".github/workflows/ci.yml");
        expect(result.files).toContain("tsconfig.json");
        expect(result.sqlDriver).toBe("sqlite");
        expect(readFileSync(join(result.targetDir, "AGENTS.md"), "utf8")).toMatch(
          /one law|on\(Trigger\)/i,
        );
        const readme = readFileSync(join(result.targetDir, "README.md"), "utf8");
        expect(readme).toMatch(/oke dev/);
        expect(readme).toMatch(new RegExp(`Notes \\(${id}\\)`, "i"));
        expect(readme).toMatch(/notes\.(create|attach|digest)|main\.health/);
        expect(readme).toMatch(/scaffold|Included vs you build/i);
        expect(readme).toMatch(/\.github\/workflows\/ci\.yml/);
        expect(readFileSync(join(result.targetDir, ".gitignore"), "utf8")).toMatch(/node_modules/);
        const ciYml = readFileSync(join(result.targetDir, ".github/workflows/ci.yml"), "utf8");
        expect(() => Bun.YAML.parse(ciYml)).not.toThrow();
        const ci = Bun.YAML.parse(ciYml) as {
          name?: string;
          on?: unknown;
          jobs?: { check?: { steps?: unknown[] } };
        };
        expect(ci.name).toBe("CI");
        expect(ci.on).toBeTruthy();
        expect(ci.jobs?.check).toBeTruthy();
        expect(ciYml).toMatch(/bun run typecheck/);
        expect(ciYml).toMatch(/bun test/);
        const appTs = readFileSync(join(result.targetDir, "src/app.ts"), "utf8");
        expect(appTs).not.toMatch(/Object\.assign/);
        expect(appTs).not.toMatch(/env:\s*["']test["']/);
        expect(appTs).toMatch(/stores:\s*\[/);
        expect(appTs).toMatch(/oke\(\{[\s\S]*stores:/);
        const pkg = JSON.parse(readFileSync(join(result.targetDir, "package.json"), "utf8")) as {
          name: string;
          dependencies: { okengine: string };
          scripts: { typecheck?: string; test?: string };
          devDependencies: { typescript?: string };
        };
        expect(pkg.name).toBe(`app-${id}`);
        expect(pkg.dependencies.okengine).not.toMatch(/^file:\.\./);
        expect(pkg.scripts.typecheck).toBe("tsc --noEmit");
        expect(pkg.scripts.test).toBe("bun test");
        expect(pkg.devDependencies.typescript).toBeTruthy();
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("standard has Notes layout (gates/vault/channels + notes flows)", () => {
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
        "src/flows/notes/index.ts",
        "src/core.ts",
        "src/schema.decl.ts",
        "src/app.ts",
      ]) {
        expect(result.files).toContain(path);
      }
      const notes = readFileSync(join(result.targetDir, "src/flows/notes/index.ts"), "utf8");
      expect(notes).toContain('name: "notes.create"');
      expect(notes).not.toContain('name: "notes.digest"');
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

describe("targetDirectoryBlockReason", () => {
  test("null when missing or empty", () => {
    const root = mkdtempSync(join(tmpdir(), "oke-target-ok-"));
    const missing = join(root, "fresh");
    const empty = join(root, "empty");
    mkdirSync(empty);
    try {
      expect(targetDirectoryBlockReason(missing)).toBeNull();
      expect(targetDirectoryBlockReason(empty)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("names the conflicting folder when not empty", () => {
    const root = mkdtempSync(join(tmpdir(), "oke-target-busy-"));
    const busy = join(root, "oke-1");
    mkdirSync(busy);
    writeFileSync(join(busy, "package.json"), "{}\n");
    try {
      const reason = targetDirectoryBlockReason(busy);
      expect(reason).toMatch(/"oke-1" already exists and is not empty/);
      expect(reason).toContain(busy);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("non-TTY CLI", () => {
  test("no args + non-TTY → zero prompts, exit 1", async () => {
    const code = await run([], { stdinIsTTY: false, runPostScaffold: false });
    expect(code).toBe(1);
  });

  test("existing non-empty dir fails before scaffold", async () => {
    const root = mkdtempSync(join(tmpdir(), "create-oke-exists-"));
    const target = join(root, "oke-1");
    mkdirSync(target);
    writeFileSync(join(target, "README.md"), "already here\n");
    try {
      const proc = Bun.spawn(
        ["bun", "run", join(packageRoot(), "src/index.ts"), target, "--yes", "--no-install"],
        {
          cwd: root,
          stdin: "pipe",
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      proc.stdin.end();
      const code = await proc.exited;
      const err = await new Response(proc.stderr).text();
      expect(code).toBe(1);
      expect(err).toMatch(/"oke-1" already exists and is not empty/);
      expect(readFileSync(join(target, "README.md"), "utf8")).toBe("already here\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
