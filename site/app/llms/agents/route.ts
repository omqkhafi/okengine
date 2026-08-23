import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Repo-root agent contract — baked in at build time. */
const CONTRACT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "AGENTS.md");

export const revalidate = false;

export function GET() {
  return new Response(readFileSync(CONTRACT, "utf8"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
