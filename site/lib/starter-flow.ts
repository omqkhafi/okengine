import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REL = "packages/create-oke/templates/standard/src/flows/main/route.ts";

/**
 * Resolve the standard starter `route.ts` from this module or `process.cwd()`.
 * `import.meta.dir` is Bun-only — Next/Turbopack leaves it undefined.
 */
function resolveStarterRoute(): string {
  const candidates: string[] = [];
  try {
    candidates.push(join(dirname(fileURLToPath(import.meta.url)), "../..", REL));
  } catch {
    // Turbopack may give a non-file `import.meta.url`.
  }
  candidates.push(join(process.cwd(), "..", REL), join(process.cwd(), REL));
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(`starter-flow: missing ${REL}`);
  }
  return found;
}

/**
 * Load the first-run welcome Flow from the standard starter for the homepage.
 */
export function loadStarterFlowSnippet(): string {
  const full = readFileSync(resolveStarterRoute(), "utf8");
  const start = full.indexOf("export const root = on(");
  if (start < 0) {
    throw new Error("starter-flow: root Flow not found");
  }
  return full.slice(start).trimEnd();
}
