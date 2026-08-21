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
  withLocalesPgDog,
  withWizardExtras,
  type InteractiveAnswers,
} from "./cli.ts";
import {
  createDefaultsPath,
  readCreateDefaults,
  toCreateDefaults,
  writeCreateDefaults,
} from "./create-defaults.ts";
import { pinsDockerReady, recommendedDefaults } from "./drivers-catalog.ts";
import { listTemplateFiles, scaffold, targetDirectoryBlockReason } from "./scaffold.ts";
import { DEFAULT_TEMPLATE, TEMPLATES, packageRoot, resolveTemplateDir } from "./templates.ts";
import {
  applyCreateAnswers,
  sanitizeProjectName,
  shouldSkipTemplatePath,
  transformConfigForSqlDriver,
  transformPackageJson,
} from "./transform.ts";

describe("withWizardExtras / withLocalesPgDog", () => {
  test("updates session defaults (reuse / customize)", () => {
    const session = recommendedDefaults("docker-ready", "advanced");
    const next = withWizardExtras({
      template: "advanced",
      locales: ["ar"],
      pgdog: true,
      proxy: "nginx",
      session,
      previous: null,
    });
    expect(next.template).toBe("advanced");
    expect(next.locales).toEqual(["ar"]);
    expect(next.pgdog).toBe(true);
    expect(next.proxy).toBe("nginx");
    expect(next.drivers.store.sql.dev).toBe(session.drivers.store.sql.dev);
  });

  test("updates previous settings when recommended has no session", () => {
    const previous = {
      ...recommendedDefaults("docker-ready", "advanced"),
      locales: [] as const,
      pgdog: false,
      proxy: "none" as const,
    };
    const next = withLocalesPgDog({
      template: "advanced",
      locales: ["ar", "fr"],
      pgdog: true,
      proxy: "traefik",
      session: undefined,
      previous,
    });
    expect(next.locales).toEqual(["ar", "fr"]);
    expect(next.pgdog).toBe(true);
    expect(next.proxy).toBe("traefik");
    expect(next.drivers).toEqual(previous.drivers);
  });

  test("falls back to recommended pins when nothing is saved", () => {
    const next = withWizardExtras({
      template: "standard",
      locales: ["ar"],
      pgdog: true,
      proxy: "caddy",
      session: undefined,
      previous: null,
    });
    expect(next.template).toBe("standard");
    expect(next.locales).toEqual(["ar"]);
    expect(next.pgdog).toBe(true);
    expect(next.proxy).toBe("caddy");
    expect(next.profile).toBe("docker-ready");
  });
});

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

  test("accepts --sql postgres (sqlite removed)", () => {
    expect(parseArgs(["x"]).sqlDriver).toBe("postgres");
    expect(parseArgs(["x"]).sqlDriverExplicit).toBe(false);
    expect(parseArgs(["x", "--sql", "postgres"]).sqlDriver).toBe("postgres");
    expect(parseArgs(["x", "--sql", "postgres"]).sqlDriverExplicit).toBe(true);
    expect(() => parseArgs(["x", "--sql=sqlite"])).toThrow(/sql/);
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

  test("accepts --locales ar,fr", () => {
    expect(parseArgs(["x", "--locales", "ar,fr"]).locales).toEqual(["ar", "fr"]);
    expect(parseArgs(["x", "--locales=ar"]).locales).toEqual(["ar"]);
    expect(parseArgs(["x"]).locales).toEqual([]);
  });

  test("accepts --pgdog / --no-pgdog", () => {
    expect(parseArgs(["x", "--pgdog"]).pgdog).toBe(true);
    expect(parseArgs(["x", "--no-pgdog"]).pgdog).toBe(false);
    expect(parseArgs(["x"]).pgdog).toBeUndefined();
    expect(() => parseArgs(["x", "--pgdog", "--no-pgdog"])).toThrow(/pgdog/);
  });

  test("accepts --proxy / --no-proxy", () => {
    expect(parseArgs(["x", "--proxy", "caddy"]).proxy).toBe("caddy");
    expect(parseArgs(["x", "--proxy=nginx"]).proxy).toBe("nginx");
    expect(parseArgs(["x", "--no-proxy"]).proxy).toBe("none");
    expect(parseArgs(["x"]).proxy).toBeUndefined();
    expect(() => parseArgs(["x", "--proxy", "nope"])).toThrow(/proxy/);
    expect(() => parseArgs(["x", "--proxy", "caddy", "--no-proxy"])).toThrow(/proxy/);
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
    locales: [],
    pgdog: false,
    proxy: "none",
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

  test("interactive defaults to postgres SQL", () => {
    expect(scaffoldArgsFromAnswers(recommendedAnswers()).sqlDriver).toBe("postgres");
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
  test("prefers ollama when prod/dev is ollama even if menu is mock", () => {
    expect(
      aiSetupProviderFor("mock", {
        dev: "mock",
        test: "mock",
        prod: "ollama",
      }),
    ).toBe("ollama");
  });

  test("keeps menu ollama", () => {
    expect(
      aiSetupProviderFor("ollama", {
        dev: "ollama",
        test: "mock",
        prod: "anthropic",
      }),
    ).toBe("ollama");
  });
});

describe("interactive branches", () => {
  test("recommended → no createDefaults, Docker-first pins, no .oke/mode", async () => {
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
      expect(config).toMatch(/vault:\s*\{\s*dev: "vault"/);
      expect(config).not.toMatch(/^\s*sql:\s*\{/m);
      expect(existsSync(join(dir, ".oke", "mode"))).toBe(false);
      expect(existsSync(join(dir, "docker", "docker-compose.yml"))).toBe(true);
      expect(existsSync(join(dir, "src", "flows", "notes", "create.ts"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("recommended advanced → advanced Notes flows + compose", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oke-rec-adv-"));
    rmSync(dir, { recursive: true, force: true });
    try {
      const code = await run([dir], {
        stdinIsTTY: true,
        runPostScaffold: false,
        ask: async () => recommendedAnswers({ name: dir, choice: "advanced" }),
      });
      expect(code).toBe(0);
      expect(existsSync(join(dir, ".oke", "mode"))).toBe(false);
      expect(existsSync(join(dir, "src", "flows", "notes", "digest.ts"))).toBe(true);
      expect(existsSync(join(dir, "src", "flows", "notes", "[id]", "attach.ts"))).toBe(true);
      const digest = readFileSync(join(dir, "src", "flows", "notes", "digest.ts"), "utf8");
      expect(digest).toContain('every("1d")');
      const attach = readFileSync(join(dir, "src", "flows", "notes", "[id]", "attach.ts"), "utf8");
      expect(attach).toContain("export const attach");
      expect(readFileSync(join(dir, "oke.config.ts"), "utf8")).toMatch(
        /index:\s*\{\s*test:\s*"memory",\s*prod:\s*"meilisearch"/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reuse previous settings round-trip", async () => {
    const home = mkdtempSync(join(tmpdir(), "oke-reuse-"));
    const path = createDefaultsPath(home);
    const base = recommendedDefaults("docker-ready");
    const saved = {
      ...base,
      drivers: {
        ...base.drivers,
        store: {
          ...base.drivers.store,
          sql: {
            dev: "postgres",
            test: "pglite",
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
      expect(config).toMatch(/vault:\s*\{\s*dev: "vault"/);
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
      profile: "docker-ready",
      drivers: {
        store: {
          sql: pinsDockerReady("postgres", "pglite"),
          kv: pinsDockerReady("redis", "memory"),
          files: pinsDockerReady("s3", "memory"),
          index: null,
        },
        signal: pinsDockerReady("redis", "memory"),
        clock: pinsDockerReady("postgres", "frozen"),
        vault: pinsDockerReady("vault", "memory"),
        channel: { email: pinsDockerReady("smtp", "console") },
        ai: null,
      },
      ai: { enabled: false, provider: null, driver: null },
      locales: [],
      pgdog: false,
      proxy: "none",
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
      expect(readCreateDefaults(path)?.drivers.store.sql.dev).toBe("postgres");
      expect(readFileSync(join(dir, "oke.config.ts"), "utf8")).toMatch(
        /vault:\s*\{\s*dev: "vault"/,
      );
      expect(existsSync(join(dir, ".oke", "mode"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
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
      expect(config).toMatch(/vault:\s*\{\s*dev: "vault"/);
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

describe("transformConfigForSqlDriver", () => {
  const config = `export default defineConfig({
  drivers: {
    store: {
      sql: {
        dev: "memory",
        test: "pglite",
        prod: "memory",
      },
    },
  },
});
`;

  test("postgres pins dev/prod and leaves test pglite", () => {
    const next = transformConfigForSqlDriver(config, "postgres");
    expect(next).toContain('dev: "postgres"');
    expect(next).toContain('prod: "postgres"');
    expect(next).toContain('test: "pglite"');
  });
});

describe("template Vite web", () => {
  test("proxies API paths and never steals GET / from the SPA", () => {
    for (const id of TEMPLATES) {
      const config = readFileSync(join(resolveTemplateDir(id), "web/vite.config.ts"), "utf8");
      expect(config).toContain('"/health"');
      expect(config).toContain('"/notes"');
      expect(config).toContain('"/_oke"');
      expect(config).toContain("127.0.0.1:6530");
      expect(config).not.toMatch(/proxy:\s*\{[^}]*["']\/["']/);
      expect(config).not.toContain("cors: true");
      expect(config).not.toContain("5173");
      expect(config).toContain('from "vite"');
      expect(config).toContain("@vitejs/plugin-react");
    }
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
  test("each clean template produces its source tree (minus skips)", async () => {
    for (const id of TEMPLATES) {
      const dir = mkdtempSync(join(tmpdir(), `create-oke-${id}-`));
      try {
        const templateDir = resolveTemplateDir(id);
        const expected = listTemplateFiles(templateDir);
        const result = await scaffold({
          targetDir: join(dir, id),
          name: `app-${id}`,
          source: { kind: "template", id },
        });
        const extras = ["AGENTS.md"];
        if (expected.includes(".env.example")) extras.push(".env.local");
        const composeExtras = result.files.filter((f) => f.startsWith("docker/"));
        expect(composeExtras.length).toBeGreaterThan(0);
        expect(result.files).toContain("docker/docker-compose.yml");
        expect(existsSync(join(result.targetDir, ".oke", "mode"))).toBe(false);
        for (const f of expected) expect(result.files).toContain(f);
        for (const f of extras) expect(result.files).toContain(f);
        expect(result.files).toContain(".gitignore");
        expect(result.files).toContain("README.md");
        expect(result.files).toContain(".github/workflows/ci.yml");
        expect(result.files).toContain("tsconfig.json");
        expect(result.sqlDriver).toBe("postgres");
        expect(readFileSync(join(result.targetDir, "AGENTS.md"), "utf8")).toMatch(
          /one law|on\(Trigger\)/i,
        );
        const readme = readFileSync(join(result.targetDir, "README.md"), "utf8");
        expect(readme).toMatch(/oke dev/);
        expect(readme).toMatch(new RegExp(`Notes \\(${id}\\)`, "i"));
        expect(readme).toMatch(/notes\.(create|attach|digest)|main\.health/);
        expect(readme).toMatch(/scaffold|Included vs you build/i);
        expect(readme).toMatch(/\.github\/workflows\/ci\.yml/);
        const gitignore = readFileSync(join(result.targetDir, ".gitignore"), "utf8");
        expect(gitignore).toMatch(/node_modules/);
        expect(gitignore).toMatch(/\.env\.docker/);
        expect(gitignore).not.toMatch(/^\/docker\/compose\.yml$/m);
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
        expect(appTs).not.toMatch(/stores:\s*\[/);
        expect(appTs).toMatch(/oke\(\{\s*name:\s*["']notes["']/);
        const pkg = JSON.parse(readFileSync(join(result.targetDir, "package.json"), "utf8")) as {
          name: string;
          dependencies: { okengine: string; "@duckdb/node-api"?: string };
          trustedDependencies?: readonly string[];
          scripts: { typecheck?: string; test?: string; web?: string; "web:build"?: string };
          devDependencies: {
            typescript?: string;
            vite?: string;
            "@electric-sql/pglite"?: string;
            "@electric-sql/pglite-pgvector"?: string;
          };
        };
        expect(pkg.name).toBe(`app-${id}`);
        expect(pkg.dependencies.okengine).not.toMatch(/^file:\.\./);
        expect(pkg.dependencies["@duckdb/node-api"]).toBe("^1.5.5-r.2");
        expect(pkg.trustedDependencies).toContain("@duckdb/node-api");
        expect(pkg.scripts.typecheck).toContain("tsc --noEmit");
        expect(pkg.scripts.typecheck).toContain("tsc -b -p web/tsconfig.json");
        expect(pkg.scripts.web).toContain("vite --config web/vite.config.ts");
        expect(pkg.scripts["web:build"]).toContain("tsc -b -p web/tsconfig.json");
        expect(pkg.scripts.test).toBe("oke test");
        expect(result.files).toContain("web/vite.config.ts");
        expect(result.files).toContain("web/src/client.ts");
        expect(pkg.devDependencies.typescript).toBeTruthy();
        expect(pkg.devDependencies.vite).toBe("^8.2.0");
        expect(pkg.devDependencies["@electric-sql/pglite"]).toBe("^0.5.4");
        expect(pkg.devDependencies["@electric-sql/pglite-pgvector"]).toBe("^0.0.5");
        const drizzle = readFileSync(join(result.targetDir, "drizzle.config.ts"), "utf8");
        expect(drizzle).toContain('dialect: "postgresql"');
        expect(drizzle).toContain("DATABASE_URL");
        expect(drizzle).toContain("OKE_STORE_SQL_URL");
        expect(drizzle).not.toContain("OKE_SQLITE_URL");
        expect(drizzle).toContain(".oke/schema/oke.ts");
        expect(existsSync(join(result.targetDir, ".oke/schema/oke.ts"))).toBe(true);
        const sqlYml = readFileSync(join(result.targetDir, "docker/docker-compose.yml"), "utf8");
        expect(sqlYml).toMatch(/healthcheck/);
        expect(sqlYml).toMatch(/pg_isready/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("standard has Notes layout (core.ts + notes flows)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "create-oke-standard-assert-"));
    try {
      const result = await scaffold({
        targetDir: join(dir, "standard"),
        name: "standard-app",
        source: { kind: "template", id: "standard" },
      });
      for (const path of [
        "src/core.ts",
        "src/locales/en.ts",
        "src/locales/index.ts",
        "src/flows/main/shapes.ts",
        "src/flows/main/signals.ts",
        "src/flows/notes/create.ts",
        "src/flows/notes/[id]/get.ts",
        "src/db/schema.decl.ts",
        "src/db/seed/index.ts",
        "src/app.ts",
        ".vscode/settings.json",
      ]) {
        expect(result.files).toContain(path);
      }
      const create = readFileSync(join(result.targetDir, "src/flows/notes/create.ts"), "utf8");
      const list = readFileSync(join(result.targetDir, "src/flows/notes/list.ts"), "utf8");
      expect(create).toContain("export const create");
      expect(list).toContain("fx.json.withQuery");
      expect(existsSync(join(result.targetDir, "src/flows/notes/digest.ts"))).toBe(false);
      expect(existsSync(join(result.targetDir, "src/locales/ar.ts"))).toBe(false);
      expect(readFileSync(join(result.targetDir, "oke.config.ts"), "utf8")).toContain(
        'locales: ["en"]',
      );
      expect(readFileSync(join(result.targetDir, "oke.config.ts"), "utf8")).not.toMatch(
        /^\s*pgdog:\s*"/m,
      );
      const appTsStandard = readFileSync(join(result.targetDir, "src/app.ts"), "utf8");
      expect(appTsStandard).toContain('import "@/core"');
      expect(appTsStandard).not.toContain('import "@/locales/');
      expect(readFileSync(join(result.targetDir, "src/core.ts"), "utf8")).toContain(
        'import "@/locales"',
      );
      const all = result.files
        .filter((f) => f.endsWith(".ts") || f.endsWith(".md"))
        .map((f) => readFileSync(join(result.targetDir, f), "utf8"))
        .join("\n");
      expect(all).not.toMatch(/\bbookings\b|\borders\b|\blinks\b|\bstripe\b/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("locales ar,fr adds catalogs and keeps en default", async () => {
    const dir = mkdtempSync(join(tmpdir(), "create-oke-locales-"));
    try {
      const result = await scaffold({
        targetDir: join(dir, "i18n-app"),
        name: "i18n-app",
        source: { kind: "template", id: "standard" },
        locales: ["ar", "fr"],
      });
      expect(result.locales).toEqual(["ar", "fr"]);
      expect(existsSync(join(result.targetDir, "src/locales/ar.ts"))).toBe(true);
      expect(existsSync(join(result.targetDir, "src/locales/fr.ts"))).toBe(true);
      const config = readFileSync(join(result.targetDir, "oke.config.ts"), "utf8");
      expect(config).toContain('"ar"');
      expect(config).toContain('"fr"');
      expect(config).toContain('"ar": "rtl"');
      const app = readFileSync(join(result.targetDir, "src/app.ts"), "utf8");
      expect(app).toContain('import "@/core"');
      expect(app).not.toContain('import "@/locales/');
      const localesIndex = readFileSync(join(result.targetDir, "src/locales/index.ts"), "utf8");
      expect(localesIndex).toContain('import "./en";');
      expect(localesIndex).toContain('import "./ar";');
      expect(localesIndex).toContain('import "./fr";');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("pgdog opt-in pins images.pgdog and compose service", async () => {
    const dir = mkdtempSync(join(tmpdir(), "create-oke-pgdog-"));
    try {
      const off = await scaffold({
        targetDir: join(dir, "no-pool"),
        name: "no-pool",
        source: { kind: "template", id: "standard" },
        pgdog: false,
      });
      expect(off.pgdog).toBe(false);
      expect(readFileSync(join(off.targetDir, "oke.config.ts"), "utf8")).not.toMatch(
        /^\s*pgdog:\s*"/m,
      );

      const on = await scaffold({
        targetDir: join(dir, "with-pool"),
        name: "with-pool",
        source: { kind: "template", id: "standard" },
        pgdog: true,
      });
      expect(on.pgdog).toBe(true);
      const config = readFileSync(join(on.targetDir, "oke.config.ts"), "utf8");
      expect(config).toMatch(/pgdog:\s*"ghcr\.io\/pgdogdev\/pgdog:/);
      const compose = readFileSync(join(on.targetDir, "docker/docker-compose.yml"), "utf8");
      expect(compose).toContain("pgdog:");
      expect(existsSync(join(on.targetDir, "docker/pgdog/pgdog.toml"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("proxy opt-in pins images.proxy and emits companion config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "create-oke-proxy-"));
    try {
      const caddy = await scaffold({
        targetDir: join(dir, "with-caddy"),
        name: "with-caddy",
        source: { kind: "template", id: "standard" },
        proxy: "caddy",
      });
      expect(caddy.proxy).toBe("caddy");
      expect(readFileSync(join(caddy.targetDir, "oke.config.ts"), "utf8")).toMatch(
        /proxy:\s*"caddy:2-alpine"/,
      );
      expect(existsSync(join(caddy.targetDir, "docker/Caddyfile"))).toBe(true);

      const nginx = await scaffold({
        targetDir: join(dir, "with-nginx"),
        name: "with-nginx",
        source: { kind: "template", id: "standard" },
        proxy: "nginx",
      });
      expect(nginx.proxy).toBe("nginx");
      expect(readFileSync(join(nginx.targetDir, "oke.config.ts"), "utf8")).toMatch(
        /proxy:\s*"nginx:1\.31-alpine"/,
      );
      expect(existsSync(join(nginx.targetDir, "docker/nginx.conf"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--sql postgres pins store.sql (abstract schema stays dialect-agnostic)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "create-oke-sql-pg-"));
    try {
      const result = await scaffold({
        targetDir: join(dir, "pg-app"),
        name: "pg-app",
        source: { kind: "template", id: "standard" },
        sqlDriver: "postgres",
      });
      expect(result.sqlDriver).toBe("postgres");
      const decl = readFileSync(join(result.targetDir, "src/db/schema.decl.ts"), "utf8");
      expect(decl).toContain("store.schema.table(");
      expect(decl).not.toContain("sqliteTable");
      expect(decl).not.toContain("pgTable");
      const drizzle = readFileSync(join(result.targetDir, "drizzle.config.ts"), "utf8");
      expect(drizzle).toContain('dialect: "postgresql"');
      expect(drizzle).toContain("schema.drizzle.ts");
      expect(drizzle).toContain(".oke/schema/oke.ts");
      const config = readFileSync(join(result.targetDir, "oke.config.ts"), "utf8");
      // postgres is DRIVER_DEFAULTS — sparse templates omit the sql map entirely.
      expect(config).not.toMatch(/^\s*sql:\s*\{/m);
      expect(config).toMatch(/vault:\s*\{\s*dev: "vault"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--no-agents-md skips AGENTS.md", async () => {
    const dir = mkdtempSync(join(tmpdir(), "create-oke-no-agents-"));
    try {
      const result = await scaffold({
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
        label: "standard",
      };
      expect(nextStepsText(result)).toContain("oke dev");
      expect(nextStepsText(result)).toContain("bun run web");
      expect(nextStepsText(result)).toContain("bun install");
      expect(nextStepsText(result)).toContain("oke.omqkhafi.dev");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
