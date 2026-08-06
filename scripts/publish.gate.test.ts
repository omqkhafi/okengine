/**
 * Publish gate: workflow shape always; pack + JSR dry-run behind `PUBLISH_GATE=1`.
 *
 * Heavy preflight (`npm pack --dry-run`, `jsr publish --dry-run`) runs from
 * `bun run gate` (sets `PUBLISH_GATE=1`), not ordinary `bun test`.
 *
 * Real npm/JSR publish is NOT part of this gate — that runs on version-tag
 * push (`v*`) after platform trusted-publisher / JSR linking is configured.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const WORKFLOW = join(ROOT, ".github/workflows/ci.yml");

/** Package roots published in lockstep. */
const PACKAGES = [
  { dir: ROOT, name: "okengine" },
  { dir: join(ROOT, "packages/create-oke"), name: "create-oke" },
] as const;

const PUBLISH_GATE = process.env.PUBLISH_GATE === "1";
if (!PUBLISH_GATE) {
  console.log("skip: npm pack / jsr publish dry-run (PUBLISH_GATE≠1; run via `bun run gate`)");
}

describe("publish workflow", () => {
  test("ci.yml parses and mirrors gflows gate → split npm/JSR publish", () => {
    expect(existsSync(WORKFLOW)).toBe(true);
    const yml = readFileSync(WORKFLOW, "utf-8");
    type PublishJob = {
      needs?: string | string[];
      environment?: string;
      permissions?: { contents?: string; "id-token"?: string };
    };
    const parsed = Bun.YAML.parse(yml) as {
      on?: {
        push?: {
          tags?: string | string[];
        };
      };
      jobs?: {
        lint?: unknown;
        typecheck?: unknown;
        test?: unknown;
        gate?: unknown;
        site?: unknown;
        ci?: { needs?: string | string[] };
        "publish-npm"?: PublishJob;
        "publish-jsr"?: PublishJob;
      };
    };

    const tags = parsed.on?.push?.tags;
    const tagList = Array.isArray(tags) ? tags : tags ? [tags] : [];
    expect(tagList).toContain("v*");

    for (const key of ["lint", "typecheck", "test", "gate", "site", "ci"] as const) {
      expect(parsed.jobs?.[key]).toBeTruthy();
    }
    expect(parsed.jobs?.["budgets"]).toBeUndefined();
    expect(parsed.jobs?.["publish-npm"]).toBeTruthy();
    expect(parsed.jobs?.["publish-jsr"]).toBeTruthy();

    const ciNeeds = parsed.jobs?.ci?.needs;
    const ciNeedList = Array.isArray(ciNeeds) ? ciNeeds : ciNeeds ? [ciNeeds] : [];
    for (const need of ["lint", "typecheck", "test", "gate", "site"]) {
      expect(ciNeedList).toContain(need);
    }
    expect(ciNeedList).not.toContain("budgets");

    for (const key of ["publish-npm", "publish-jsr"] as const) {
      const job = parsed.jobs?.[key];
      expect(job?.needs).toBe("ci");
      expect(job?.environment).toBe("production");
      expect(job?.permissions?.contents).toBe("read");
      expect(job?.permissions?.["id-token"]).toBe("write");
    }

    // Step commands (string search — Bun.YAML keeps step `run` as strings)
    expect(yml).toContain("bun run lint");
    expect(yml).toContain("bun run fmt:check");
    expect(yml).toContain("bun run typecheck");
    expect(yml).toContain("bun run test");
    expect(yml).not.toContain("bun run budgets");
    expect(yml).toContain("bun run gate");
    expect(yml).toContain("bun run site:build");
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
      const pkg = JSON.parse(readFileSync(join(p.dir, "package.json"), "utf-8")) as {
        version: string;
      };
      const jsr = JSON.parse(readFileSync(join(p.dir, "jsr.json"), "utf-8")) as { version: string };
      return { name: p.name, pkg: pkg.version, jsr: jsr.version };
    });
    const v = versions[0]!.pkg;
    for (const row of versions) {
      expect(row.pkg).toBe(v);
      expect(row.jsr).toBe(v);
    }
  });

  test("bump-version --dry-run touches both package.json files and changelog", async () => {
    const proc = Bun.spawn(["bun", "run", "scripts/bump-version.ts", "patch", "--dry-run"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;
    expect(code, stderr).toBe(0);
    expect(stderr).toContain("package.json");
    expect(stderr).toContain("packages/create-oke/package.json");
    expect(stderr).toContain("changelog.md");
    // Both paths appear; versions in dry-run output share one arrow target.
    const match = stderr.match(/→\s+(\d+\.\d+\.\d+)/);
    expect(match?.[1]).toBeTruthy();
    // Starters are never part of the lockstep bump.
    expect(stderr).not.toMatch(/template\/package\.json/);
  });

  test("starters stay at seed version 0.0.1", () => {
    for (const id of ["standard", "advanced"] as const) {
      const pkgPath = join(ROOT, "packages/create-oke/templates", id, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        version?: string;
      };
      expect(pkg.version).toBe("0.0.1");
    }
  });

  test("package.json has no publish lifecycle script (npm re-entry footgun)", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.publish).toBeUndefined();
    expect(pkg.scripts?.postpublish).toBeUndefined();
    expect(pkg.scripts?.release).toBe("bun run scripts/publish.ts");
  });

  test("publish.ts passes --ignore-scripts to npm publish", () => {
    const src = readFileSync(join(ROOT, "scripts/publish.ts"), "utf-8");
    expect(src).toContain("--ignore-scripts");
  });
});

describe.skipIf(!PUBLISH_GATE)("npm pack includes Console SPA", () => {
  test("okengine tarball contains src/console/ui/dist/index.html", async () => {
    const build = Bun.spawn(["bun", "run", "build"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const buildCode = await build.exited;
    expect(buildCode).toBe(0);

    const pack = Bun.spawn(["npm", "pack", "--dry-run"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(pack.stdout).text(),
      new Response(pack.stderr).text(),
      pack.exited,
    ]);
    expect(code).toBe(0);
    const out = `${stdout}\n${stderr}`;
    expect(out).toMatch(/src\/console\/ui\/dist\/index\.html/);
  }, 180_000);
});

describe.skipIf(!PUBLISH_GATE)("jsr publish --dry-run", () => {
  for (const pkg of PACKAGES) {
    test(`${pkg.name}: bunx jsr publish --dry-run`, async () => {
      const proc = Bun.spawn(["bunx", "jsr", "publish", "--dry-run", "--allow-dirty"], {
        cwd: pkg.dir,
        stdout: "pipe",
        stderr: "pipe",
      });
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
      expect(/dry run|would publish|checking|success|Simulating/i.test(out)).toBe(true);
    }, 120_000);
  }
});
