/**
 * `oke mode [local|docker]` — read or set the saved `oke dev` preference.
 * Setting a mode also syncs domain schema for that env (emit + push).
 */

import { parseDevMode, readDevMode, writeDevMode, type DevMode } from "./dev-mode.ts";
import { sqlDialectForEnv, syncDevSchema } from "./dev-schema-sync.ts";
import { loadOkeConfig } from "./load-config.ts";

/**
 * CLI entry for `oke mode`.
 *
 * @param args - Args after `mode`
 */
export async function modeCli(args: readonly string[]): Promise<number> {
  const cwd = process.cwd();
  for (const a of args) {
    if (a === "--help" || a === "-h") {
      console.log(`oke mode [local|docker]

Get or set the default infrastructure mode for \`oke dev\`
(saved in .oke/mode). Setting a mode syncs domain schema for that env:
emits schema.generated.ts for the active dialect, then runs \`oke db push\`.
Data planes stay isolated — switching modes never copies rows.
Session flags \`oke dev --local\` / \`oke dev --docker\` never change this
preference.
`);
      return 0;
    }
  }

  const positional = args.filter((a) => !a.startsWith("-"));
  if (positional.length === 0) {
    const saved = await readDevMode(cwd);
    if (saved === null) {
      console.log("oke mode: unset (default local until chosen)");
      return 0;
    }
    console.log(saved);
    return 0;
  }

  const next = parseDevMode(positional[0]);
  if (next === null) {
    console.error(`oke mode: expected local|docker, got ${JSON.stringify(positional[0])}`);
    return 1;
  }
  await writeDevMode(cwd, next satisfies DevMode);

  try {
    const result = await syncDevSchema(cwd, next);
    console.log(`oke mode: saved ${next} · dialect ${result.dialect}`);
    return result.code;
  } catch (err) {
    const loaded = await loadOkeConfig(cwd).catch(() => null);
    const dialect = loaded?.config
      ? sqlDialectForEnv(loaded.config, next).dialect
      : next === "docker"
        ? "postgresql"
        : "sqlite";
    console.error(`oke mode: saved ${next} · dialect ${dialect}`);
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
