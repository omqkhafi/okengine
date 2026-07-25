/**
 * Unit tests for create-oke argument parsing and transforms.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatCdPath, parseArgs } from "./cli.ts";
import { listTemplateFiles, scaffold } from "./scaffold.ts";
import { resolveTemplateDir, TEMPLATES } from "./templates.ts";
import {
  sanitizeProjectName,
  shouldSkipTemplatePath,
  transformPackageJson,
} from "./transform.ts";

describe("parseArgs", () => {
  test("defaults template to notes", () => {
    const a = parseArgs(["my-app"]);
    expect(a.name).toBe("my-app");
    expect(a.template).toBe("notes");
  });

  test("accepts --template and -t", () => {
    expect(parseArgs(["x", "--template", "linkly"]).template).toBe("linkly");
    expect(parseArgs(["x", "-t", "skyport"]).template).toBe("skyport");
    expect(parseArgs(["x", "--template=provisions"]).template).toBe(
      "provisions",
    );
  });

  test("rejects unknown template", () => {
    expect(() => parseArgs(["x", "--template", "nope"])).toThrow(/template/);
  });
});

describe("transformPackageJson", () => {
  test("rewrites name and okengine file:../.. to installable ref", () => {
    const next = transformPackageJson(
      {
        name: "@oke/example-notes",
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
  test("each template produces the example tree (minus skips)", () => {
    for (const id of TEMPLATES) {
      const dir = mkdtempSync(join(tmpdir(), `create-oke-${id}-`));
      try {
        const templateDir = resolveTemplateDir(id);
        const expected = listTemplateFiles(templateDir);
        const result = scaffold({
          targetDir: join(dir, id),
          name: `app-${id}`,
          template: id,
        });
        expect([...result.files].sort()).toEqual(expected);
        const pkg = JSON.parse(
          readFileSync(join(result.targetDir, "package.json"), "utf8"),
        ) as { name: string; dependencies: { okengine: string } };
        expect(pkg.name).toBe(`app-${id}`);
        expect(pkg.dependencies.okengine).not.toBe("file:../..");
        expect(
          pkg.dependencies.okengine.startsWith("file:") ||
            /^\d+\.\d+\.\d+/.test(pkg.dependencies.okengine),
        ).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});
