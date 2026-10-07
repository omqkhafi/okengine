import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TEST_SHARDS, shardFor } from "./ci-test-shards.ts";

const ROOT = join(import.meta.dir, "..");

function ignored(file: string): boolean {
  return (
    file.endsWith(".live.test.ts") ||
    file.startsWith("tests/console/") ||
    file.startsWith("packages/create-oke/templates/") ||
    file.startsWith("examples/") ||
    file.startsWith("site/")
  );
}

async function defaultTestFiles(): Promise<string[]> {
  const glob = new Bun.Glob("**/*.{test,spec}.ts");
  const files: string[] = [];
  for await (const file of glob.scan({ cwd: ROOT, onlyFiles: true })) {
    if (!ignored(file)) files.push(file);
  }
  return files;
}

describe("CI test shards", () => {
  test("every default test file is in exactly one shard", async () => {
    const files = await defaultTestFiles();
    expect(files.length).toBeGreaterThan(0);
    const missed = files.filter((file) => shardFor(file) === null);
    expect(missed).toEqual([]);
  });

  test("ci.yml runs each shard and does not cancel the rest", () => {
    const yml = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(yml).toContain("fail-fast: false");
    for (const shard of TEST_SHARDS) {
      expect(yml).toContain(`name: ${shard.name}`);
      for (const path of shard.paths) expect(yml).toContain(path);
    }
  });
});
