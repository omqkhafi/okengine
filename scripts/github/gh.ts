/**
 * Thin `gh api` wrapper for the workflow scripts. No npm installs.
 */

export interface GhApiOptions {
  /** Overrides `GH_TOKEN` for this call. */
  readonly token?: string;
  /** JSON body passed on stdin (`--input -`). */
  readonly input?: string;
}

/**
 * Run `gh api` and return stdout.
 *
 * @param args - Arguments after `gh api`
 * @param options - Token override and optional stdin body
 */
export async function ghApi(args: readonly string[], options: GhApiOptions = {}): Promise<string> {
  const proc = Bun.spawn(["gh", "api", ...args], {
    env: spawnEnv(options.token),
    stdin: options.input === undefined ? "ignore" : Buffer.from(options.input),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`gh api ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
  }
  return stdout;
}

/**
 * @param query - GraphQL query document
 * @param variables - Query variables
 * @param token - Optional token override
 */
export async function ghGraphql<T>(
  query: string,
  variables: Readonly<Record<string, unknown>>,
  token?: string,
): Promise<T> {
  const raw = await ghApi(["graphql", "--input", "-"], {
    token,
    input: JSON.stringify({ query, variables }),
  });
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new Error("GraphQL response was not an object");
  const errors = parsed["errors"];
  if (Array.isArray(errors) && errors.length > 0) {
    const messages = errors.map((error) => {
      if (isRecord(error) && typeof error["message"] === "string") return error["message"];
      return "unknown graphql error";
    });
    throw new Error(messages.join("\n"));
  }
  const data = parsed["data"];
  if (data === undefined || data === null) throw new Error("GraphQL response had no data");
  return data as T;
}

/** @param value - Unknown JSON value */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function spawnEnv(token: string | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  if (token !== undefined) env["GH_TOKEN"] = token;
  return env;
}
