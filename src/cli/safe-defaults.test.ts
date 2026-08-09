/**
 * Safe-default audit: consequential choices require an explicit, undefaulted flag.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerCli } from "./docker.ts";
import { privacyEraseCli } from "./privacy-erase.ts";
import { runImagesPin } from "./images.ts";
import { upgradeCli } from "./upgrade.ts";

describe("oke safe-default overrides", () => {
  test("docker prod overlays are on by default; --no-prod opts out", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-safe-docker-"));
    await Bun.write(
      join(dir, "oke.config.ts"),
      `export default { images: { store: { sql: "postgres:18-alpine" } } }\n`,
    );
    const { runDockerDerive } = await import("./docker.ts");

    // Default layout is single: prod readiness/deploy folds into docker-compose.yml
    // (no separate compose.prod.yml). Assert production-grade content is present.
    const defaults = await runDockerDerive({
      cwd: dir,
      outDir: dir,
      images: { "store.sql": "postgres:18-alpine" },
      dryRun: true,
      write: () => {},
    });
    expect(defaults.code).toBe(0);
    const defaultCompose = defaults.result?.files.find((f) => f.path === "docker-compose.yml");
    expect(defaultCompose).toBeDefined();
    expect(defaultCompose!.content).toContain("/_/ready");
    expect(defaults.result?.files.some((f) => f.path.includes("prod"))).toBe(false);

    const noProd = await runDockerDerive({
      cwd: dir,
      outDir: dir,
      images: { "store.sql": "postgres:18-alpine" },
      prod: false,
      dryRun: true,
      write: () => {},
    });
    expect(noProd.code).toBe(0);
    const noProdCompose = noProd.result?.files.find((f) => f.path === "docker-compose.yml");
    expect(noProdCompose).toBeDefined();
    expect(noProdCompose!.content).not.toContain("/_/ready");

    // Split layout still emits a separate compose.prod.yml when prod is on.
    const splitProd = await runDockerDerive({
      cwd: dir,
      outDir: dir,
      images: { "store.sql": "postgres:18-alpine" },
      prod: true,
      layout: "split",
      dryRun: true,
      write: () => {},
    });
    expect(splitProd.code).toBe(0);
    expect(splitProd.result?.files.some((f) => f.path === "compose.prod.yml")).toBe(true);

    expect(await dockerCli(["--help"])).toBe(0);
  });

  test("upgrade is dry-run unless --apply|-a is passed", async () => {
    const { runUpgrade } = await import("./upgrade.ts");
    const dryDir = await mkdtemp(join(tmpdir(), "oke-safe-upgrade-"));
    await runUpgrade({
      cwd: dryDir,
      dryRun: true,
      runCodemods: async () => [{ path: "x.ts", before: "a", after: "b" }],
      write: () => {},
    });
    expect(await Bun.file(join(dryDir, "x.ts")).exists()).toBe(false);

    const applyDir = await mkdtemp(join(tmpdir(), "oke-safe-upgrade-apply-"));
    await runUpgrade({
      cwd: applyDir,
      dryRun: false,
      runCodemods: async () => [{ path: "x.ts", before: "a", after: "b" }],
      write: () => {},
    });
    expect(await Bun.file(join(applyDir, "x.ts")).text()).toBe("b");
    expect(await upgradeCli(["--help"])).toBe(0);
  });

  test("privacy erase requires explicit --subject|-s", async () => {
    expect(await privacyEraseCli([])).toBe(1);
    expect(await privacyEraseCli(["--subject", "user_1"])).toBe(0);
    expect(await privacyEraseCli(["-s", "user_2"])).toBe(0);
  });

  test("images pin only runs when the pin subcommand is invoked", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-safe-pin-"));
    const { imagesCli } = await import("./images.ts");
    // Bare `images` is usage — never pins.
    expect(await imagesCli([])).toBe(1);
    expect(await Bun.file(join(dir, "oke.images.lock")).exists()).toBe(false);

    await runImagesPin({
      cwd: dir,
      images: { "store.sql": "postgres:16" },
      resolveDigest: async () => "sha256:abc",
      write: () => {},
    });
    expect(await Bun.file(join(dir, "oke.images.lock")).exists()).toBe(true);
  });
});
