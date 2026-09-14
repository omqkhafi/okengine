import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_REL = "packages/create-oke/templates/shorter/src/flows/main/route.ts";
const CREATE_REL = "packages/create-oke/templates/shorter/src/flows/links/create.ts";
const ON_CREATED_REL = "packages/create-oke/templates/shorter/src/flows/links/signals.ts";

/**
 * Resolve a starter file from this module or `process.cwd()`.
 * `import.meta.dir` is Bun-only — Next/Turbopack leaves it undefined.
 *
 * @param rel - Path from the repo root
 */
function resolveStarterFile(rel: string): string {
  const candidates: string[] = [];
  try {
    candidates.push(join(dirname(fileURLToPath(import.meta.url)), "../..", rel));
  } catch {
    // Turbopack may give a non-file `import.meta.url`.
  }
  candidates.push(join(process.cwd(), "..", rel), join(process.cwd(), rel));
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(`starter-flow: missing ${rel}`);
  }
  return found;
}

/**
 * Slice an exported Flow from a starter source file.
 * Stops at the next top-level `export` so colocated bindings are not included.
 *
 * @param rel - Path from the repo root
 * @param marker - `export const … = on(` start token
 */
function loadExportedOn(rel: string, marker: string): string {
  const full = readFileSync(resolveStarterFile(rel), "utf8");
  const start = full.indexOf(marker);
  if (start < 0) {
    throw new Error(`starter-flow: ${marker} not found in ${rel}`);
  }
  const rest = full.slice(start);
  const next = rest.search(/\nexport /);
  return (next >= 0 ? rest.slice(0, next) : rest).trimEnd();
}

/**
 * Load the first-run welcome Flow from the shorter starter for the homepage.
 */
export function loadStarterFlowSnippet(): string {
  return loadExportedOn(ROOT_REL, "export const root = on(");
}

/**
 * Load the links create Flow — the homepage fx walk's source of truth.
 */
export function loadCreateFlowSnippet(): string {
  return loadExportedOn(CREATE_REL, "export const create = on(");
}

/**
 * Load the links on-created Flow — Channel send from the same emit.
 */
export function loadOnCreatedFlowSnippet(): string {
  return loadExportedOn(ON_CREATED_REL, "export const onCreated = on(");
}

/**
 * Compact typed-client call: Try It `createClient<App>` form, starter
 * `links.create` input. Envelope is a value — `{ data, error }`.
 */
export const CLIENT_CREATE_SNIPPET = `import { createClient } from "okengine/client";
import type { App } from "./app";

const api = createClient<App>("http://localhost:6530");
const { data, error } = await api.links.create({
  url: "https://oke.omqkhafi.dev",
});
`;
