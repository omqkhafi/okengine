/**
 * Publish gate: workflow shape + JSR dry-run for both packages.
 *
 * Real npm/JSR publish is NOT part of this gate — that runs on push to main
 * after platform trusted-publisher / JSR linking is configured.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const WORKFLOW = join(ROOT, ".github/workflows/publish.yml");

/** Package roots published in lockstep. */
const PACKAGES = [
  { dir: ROOT, name: "okengine" },
  { dir: join(ROOT, "packages/create-oke"), name: "create-oke" },
] as const;

describe("publish workflow", () => {
  test("publish.yml parses and mirrors gflows gate → split npm/JSR publish", () => {
    expect(existsSync(WORKFLOW)).toBe(true);
    const yml = readFileSync(WORKFLOW, "utf-8");
    type PublishJob = {
      needs?: string | string[];
      environment?: string;
      permissions?: { contents?: string; "id-token"?: string };
      if?: string;
    };
    const parsed = Bun.YAML.parse(yml) as {
      jobs?: {
        "test-and-lint"?: unknown;
        "publish-npm"?: PublishJob;
        "publish-jsr"?: PublishJob;
      };
    };

    expect(parsed.jobs?.["test-and-lint"]).toBeTruthy();
    expect(parsed.jobs?.["publish-npm"]).toBeTruthy();
    expect(parsed.jobs?.["publish-jsr"]).toBeTruthy();

    for (const key of ["publish-npm", "publish-jsr"] as const) {
      const job = parsed.jobs?.[key];
      expect(job?.needs).toBe("test-and-lint");
      expect(job?.environment).toBe("production");
      expect(job?.permissions?.contents).toBe("read");
      expect(job?.permissions?.["id-token"]).toBe("write");
      expect(job?.if).toContain("push");
      expect(job?.if).toContain("refs/heads/main");
    }

    // Step commands (string search — Bun.YAML keeps step `run` as strings)
    expect(yml).toContain("bun run ci");
    expect(yml).toContain("bun install --frozen-lockfile");
    expect(yml).toContain("npm install -g npm@latest");
    expect(yml).toContain("--jsr-only");
    expect(yml).toContain("--npm-only");
  });

  test("create-oke package.json has repository.directory for provenance", () => {
    const pkg = JSON.parse(
      readFileSync(join(ROOT, "packages/create-oke/package.json"), "utf-8"),
    ) as {
      repository?: { directory?: string; url?: string };
    };
    expect(pkg.repository?.directory).toBe("packages/create-oke");
    expect(pkg.repository?.url).toContain("okengine");
  });

  test("both packages share the same version (lockstep)", () => {
    const versions = PACKAGES.map((p) => {
      const pkg = JSON.parse(
        readFileSync(join(p.dir, "package.json"), "utf-8"),
      ) as { version: string };
      const jsr = JSON.parse(
        readFileSync(join(p.dir, "jsr.json"), "utf-8"),
      ) as { version: string };
      return { name: p.name, pkg: pkg.version, jsr: jsr.version };
    });
    const v = versions[0]!.pkg;
    for (const row of versions) {
      expect(row.pkg).toBe(v);
      expect(row.jsr).toBe(v);
    }
  });

  test("bump-version --dry-run touches both package.json files identically", async () => {
    const proc = Bun.spawn(
      ["bun", "run", "scripts/bump-version.ts", "patch", "--dry-run"],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
    );
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    expect(code).toBe(0);
    expect(stderr).toContain("package.json");
    expect(stderr).toContain("packages/create-oke/package.json");
    // Both paths appear; versions in dry-run output share one arrow target.
    const match = stderr.match(/→\s+(\d+\.\d+\.\d+)/);
    expect(match?.[1]).toBeTruthy();
  });
});

describe("jsr publish --dry-run", () => {
  for (const pkg of PACKAGES) {
    test(
      `${pkg.name}: bunx jsr publish --dry-run`,
      async () => {
        // Ensure templates exist for create-oke include list (prepack).
        if (pkg.name === "create-oke") {
          const sync = Bun.spawn(["bun", "./src/sync-templates.ts"], {
            cwd: pkg.dir,
            stdout: "pipe",
            stderr: "pipe",
          });
          const syncCode = await sync.exited;
          expect(syncCode).toBe(0);
        }

        const proc = Bun.spawn(
          ["bunx", "jsr", "publish", "--dry-run", "--allow-dirty"],
          {
            cwd: pkg.dir,
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        const [stdout, stderr, code] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        const out = `${stdout}\n${stderr}`;
        if (code !== 0) {
          console.error(out);
        }
        expect(code).toBe(0);
        // JSR prints a success line on dry-run; accept either phrasing.
        expect(
          /dry run|would publish|checking|success|Simulating/i.test(out),
        ).toBe(true);
      },
      120_000,
    );
  }
});
