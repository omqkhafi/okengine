/**
 * Unit tests for create-oke argument parsing, transforms, and non-TTY behavior.
 */

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FROM_EXAMPLE_CHOICE,
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
import {
  DEFAULT_TEMPLATE,
  EXAMPLES,
  TEMPLATES,
  packageRoot,
  resolveExampleDir,
  resolveTemplateDir,
} from "./templates.ts";
import {
  sanitizeProjectName,
  shouldSkipTemplatePath,
  transformPackageJson,
} from "./transform.ts";

describe("parseArgs", () => {
  test("defaults template to standard", () => {
    const a = parseArgs(["my-app"]);
    expect(a.name).toBe("my-app");
    expect(a.template).toBe("standard");
    expect(a.templateExplicit).toBe(false);
    expect(a.fromExample).toBeUndefined();
  });

  test("accepts --template and -t", () => {
    expect(parseArgs(["x", "--template", "hello"]).template).toBe("hello");
    expect(parseArgs(["x", "-t", "full"]).template).toBe("full");
    expect(parseArgs(["x", "--template=minimal"]).template).toBe("minimal");
    expect(parseArgs(["x", "--template", "hello"]).templateExplicit).toBe(true);
  });

  test("accepts --from-example", () => {
    expect(parseArgs(["x", "--from-example", "notes"]).fromExample).toBe(
      "notes",
    );
    expect(parseArgs(["x", "--from-example=skyport"]).fromExample).toBe(
      "skyport",
    );
  });

  test("rejects unknown template / example / both", () => {
    expect(() => parseArgs(["x", "--template", "nope"])).toThrow(/template/);
    expect(() => parseArgs(["x", "--from-example", "nope"])).toThrow(/example/);
    expect(() =>
      parseArgs(["x", "--template", "hello", "--from-example", "notes"]),
    ).toThrow(/either/);
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
    expect(shouldPrompt(parseArgs(["my-app", "--template", "hello"]), true)).toBe(
      false,
    );
    expect(shouldPrompt(parseArgs(["--template", "hello"]), true)).toBe(false);
    expect(shouldPrompt(parseArgs(["--from-example", "notes"]), true)).toBe(
      false,
    );
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
    expect(() => parseArgs(["x", "--install", "--no-install"])).toThrow(
      /install/,
    );
  });
});

describe("sourceFromArgs", () => {
  test("prefers example when set", () => {
    expect(sourceFromArgs(parseArgs(["x", "--from-example", "linkly"]))).toEqual(
      { kind: "example", id: "linkly" },
    );
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
      const fromFlags = scaffoldArgsFromCli(
        parseArgs(["x", "--template", id]),
      );
      expect(fromAnswers).toEqual(fromFlags);
      expect(fromAnswers.source).toEqual({ kind: "template", id });
    }
  });

  test("each --from-example path matches interactive from-example choice", () => {
    for (const id of EXAMPLES) {
      const answers: InteractiveAnswers = {
        name: "x",
        choice: FROM_EXAMPLE_CHOICE,
        example: id,
        installAndRun: false,
        agentsMd: true,
      };
      const fromAnswers = scaffoldArgsFromAnswers(answers);
      const fromFlags = scaffoldArgsFromCli(
        parseArgs(["x", "--from-example", id]),
      );
      expect(fromAnswers).toEqual(fromFlags);
      expect(fromAnswers.source).toEqual({ kind: "example", id });
    }
  });

  test("8 paths cover every template and every example", () => {
    expect(TEMPLATES.length + EXAMPLES.length).toBe(8);
  });
});

describe("transformPackageJson", () => {
  test("rewrites name and okengine file:../.. to installable ref", () => {
    const next = transformPackageJson(
      {
        name: "@oke/template-hello",
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

describe("shouldSkipTemplatePath", () => {
  test("skips node_modules, locks, and monorepo docker test", () => {
    expect(shouldSkipTemplatePath("node_modules/okengine/package.json")).toBe(
      true,
    );
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
        expect([...result.files].sort()).toEqual(
          [...expected, "AGENTS.md"].sort(),
        );
        expect(result.files).toContain(".gitignore");
        expect(result.files).toContain("README.md");
        expect(
          readFileSync(join(result.targetDir, "AGENTS.md"), "utf8"),
        ).toMatch(/one law|on\(Trigger\)/i);
        const readme = readFileSync(join(result.targetDir, "README.md"), "utf8");
        expect(readme).toMatch(/oke dev/);
        expect(readme).toMatch(new RegExp(`^# ${id}`, "m"));
        expect(
          readFileSync(join(result.targetDir, ".gitignore"), "utf8"),
        ).toMatch(/node_modules/);
        const pkg = JSON.parse(
          readFileSync(join(result.targetDir, "package.json"), "utf8"),
        ) as { name: string; dependencies: { okengine: string } };
        expect(pkg.name).toBe(`app-${id}`);
        expect(pkg.dependencies.okengine).not.toBe("file:../..");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  test("hello has exactly one flow and no Store", () => {
    const dir = mkdtempSync(join(tmpdir(), "create-oke-hello-assert-"));
    try {
      const result = scaffold({
        targetDir: join(dir, "hello"),
        name: "hello-app",
        source: { kind: "template", id: "hello" },
      });
      const flowFiles = result.files.filter(
        (f) => f.startsWith("src/flows/") && f.endsWith(".ts"),
      );
      expect(flowFiles).toEqual(["src/flows/hello/index.ts"]);
      const flowSrc = readFileSync(
        join(result.targetDir, "src/flows/hello/index.ts"),
        "utf8",
      );
      expect(flowSrc).toMatch(/export const hello/);
      expect(flowSrc).not.toMatch(/\bstore\b/);
      expect(result.files.some((f) => f.includes("core.ts"))).toBe(false);
      expect(result.files.some((f) => f.includes("schema.ts"))).toBe(false);
      const all = result.files
        .filter((f) => f.endsWith(".ts"))
        .map((f) => readFileSync(join(result.targetDir, f), "utf8"))
        .join("\n");
      expect(all).not.toMatch(/store\.sql/);
      expect(all).not.toMatch(/\bbookings\b|\borders\b|\blinks\b|\bnotes\b/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
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
        "src/schema.ts",
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

  test("--from-example notes matches today's example tree", () => {
    const dir = mkdtempSync(join(tmpdir(), "create-oke-from-example-"));
    try {
      const exampleDir = resolveExampleDir("notes");
      const expected = listTemplateFiles(exampleDir);
      const result = scaffold({
        targetDir: join(dir, "notes"),
        name: "from-notes",
        source: { kind: "example", id: "notes" },
      });
      expect([...result.files].sort()).toEqual(
        [...expected, "AGENTS.md"].sort(),
      );
      expect(result.files).toContain("src/flows/notes/index.ts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("--no-agents-md skips AGENTS.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "create-oke-no-agents-"));
    try {
      const result = scaffold({
        targetDir: join(dir, "hello"),
        name: "no-agents",
        source: { kind: "template", id: "hello" },
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
      const code = await run(
        [target, "--template", "hello", "--no-install"],
        { stdinIsTTY: false, runPostScaffold: false },
      );
      expect(code).toBe(0);
      expect(readdirSync(target).length).toBeGreaterThan(0);
      expect(existsSync(join(target, "AGENTS.md"))).toBe(true);
      const result = {
        targetDir: target,
        name: "flag-app",
        source: { kind: "template" as const, id: "hello" as const },
        label: "hello",
        okengineDependency: "x",
        files: [],
      };
      expect(nextStepsText(result)).toContain("oke dev");
      expect(nextStepsText(result)).toContain("bun install");
      expect(nextStepsText(result)).toContain("okengine.vercel.app");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("examples catalogue", () => {
  test("all four teaching examples resolve", () => {
    for (const id of EXAMPLES) {
      expect(resolveExampleDir(id)).toBeTruthy();
    }
  });
});
