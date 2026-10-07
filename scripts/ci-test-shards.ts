/**
 * CI splits `bun test` into parallel jobs. One shard failing does not cancel
 * the others. Every default test file belongs to exactly one shard.
 *
 * Paths match `bunfig.toml` discovery: live tests, Console Playwright, starter
 * templates, examples, and the site stay out of these jobs.
 */

export interface TestShard {
  readonly name: string;
  readonly paths: readonly string[];
}

export const TEST_SHARDS: readonly TestShard[] = [
  { name: "console", paths: ["src/console"] },
  { name: "elements", paths: ["src/elements"] },
  { name: "kernel", paths: ["src/kernel"] },
  { name: "cli", paths: ["src/cli", "scripts", "packages/create-oke"] },
  { name: "drivers", paths: ["src/drivers", "src/plugins", "src/auth", "src/docker"] },
  {
    name: "core",
    paths: [
      "src/compiler",
      "src/client",
      "src/client-react",
      "src/manifest",
      "src/runtime",
      "src/release",
      "src/runs",
      "src/mcp",
      "src/config",
      "src/i18n",
      "src/validation",
      "src/upgrade",
      "src/test",
      "src/okid.test.ts",
      "src/term.test.ts",
      "src/okid.bench.test.ts",
    ],
  },
];

/** @param file - Repo-relative test path */
export function shardFor(file: string): string | null {
  const owners = TEST_SHARDS.filter((shard) => shard.paths.some((path) => covers(file, path)));
  if (owners.length !== 1) return null;
  return owners[0]!.name;
}

function covers(file: string, path: string): boolean {
  return file === path || file.startsWith(`${path}/`);
}
