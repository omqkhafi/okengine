/**
 * `oke test` — run `bun test` with PGLite test posture (no Docker Compose).
 */

/**
 * CLI entry for `oke test`.
 *
 * Sets `NODE_ENV=test` and a default in-memory PGLite URL, verifies
 * `@electric-sql/pglite` resolves, then forwards remaining argv to `bun test`.
 *
 * @param args - Args after `test` (forwarded to `bun test`)
 */
export async function testCli(args: readonly string[]): Promise<number> {
  for (const a of args) {
    if (a === "--help" || a === "-h") {
      console.log(`oke test [...bun test args]

Run bun test with PGLite test posture (NODE_ENV=test).
Does not start Docker Compose.

Environment (set if unset):
  NODE_ENV=test
  OKE_PGLITE_URL=memory://
`);
      return 0;
    }
  }

  if (process.env.NODE_ENV === undefined || process.env.NODE_ENV === "") {
    process.env.NODE_ENV = "test";
  }
  if (process.env.OKE_PGLITE_URL === undefined || process.env.OKE_PGLITE_URL === "") {
    process.env.OKE_PGLITE_URL = "memory://";
  }

  try {
    await import("@electric-sql/pglite");
  } catch {
    try {
      Bun.resolveSync("@electric-sql/pglite", process.cwd());
    } catch {
      console.error(
        "oke test: `@electric-sql/pglite` is not installed — add it as a dependency (okengine peers it for the pglite SQL driver)",
      );
      return 1;
    }
  }

  const proc = Bun.spawn(["bun", "test", ...args], {
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  return code ?? 1;
}
