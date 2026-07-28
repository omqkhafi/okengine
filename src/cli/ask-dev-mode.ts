/**
 * One-time interactive `oke dev` mode choice via `@clack/prompts`.
 */

import { isCancel, select } from "@clack/prompts";
import type { DevMode } from "./dev-mode.ts";

/**
 * Injectable ask step — production uses {@link askDevMode}.
 *
 * @returns Chosen mode, or `null` if the user cancelled
 */
export type AskDevModeFn = () => Promise<DevMode | null>;

/**
 * Prompt once: local vs docker.
 *
 * @returns Chosen mode, or `null` on cancel
 */
export async function askDevMode(): Promise<DevMode | null> {
  const value = await select({
    message: "Run against",
    options: [
      {
        value: "local",
        label: "local",
        hint: "in-memory, instant, no Docker needed",
      },
      {
        value: "docker",
        label: "docker",
        hint: "real Postgres/Redis via compose, closer to production",
      },
    ],
    initialValue: "local",
  });
  if (isCancel(value)) return null;
  if (value === "local" || value === "docker") return value;
  return null;
}
