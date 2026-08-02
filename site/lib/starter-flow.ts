import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Load the first Flow from the standard starter for the homepage. */
export function loadStarterFlowSnippet(): string {
  const path = join(
    process.cwd(),
    "..",
    "packages/create-oke/templates/standard/src/flows/main/index.ts",
  );
  const full = readFileSync(path, "utf8");
  const start = full.indexOf("export const root = on(");
  const endMarker = "\n);\n\n/** Liveness";
  const end = full.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error("starter-flow: root Flow not found");
  }
  return full.slice(start, end + 3).trimEnd();
}
