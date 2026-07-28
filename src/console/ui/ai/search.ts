/**
 * Typed search params for the AI panel (console §7 · §9.10).
 */

import { z } from "zod";

/** URL search schema. */
export const AiSearchSchema = z.object({
  /** Selected prompt name. */
  prompt: z.string().optional(),
  /** Selected prompt version. */
  version: z.coerce.number().int().optional(),
  /** Selected agent name. */
  agent: z.string().optional(),
  /** Selected agent run id. */
  run: z.string().optional(),
  /** List filter. */
  q: z.string().optional(),
});

/** Parsed AI search state. */
export type AiSearch = z.infer<typeof AiSearchSchema>;

/**
 * Parse router search into typed AI search.
 *
 * @param search - Raw search
 */
export function parseAiSearch(search: Record<string, unknown>): AiSearch {
  const parsed = AiSearchSchema.safeParse(search);
  return parsed.success ? parsed.data : {};
}

/**
 * Serialize AI search for navigation (drop empties).
 *
 * @param search - Typed search
 */
export function serializeAiSearch(search: AiSearch): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (search.prompt) out.prompt = search.prompt;
  if (search.version !== undefined) out.version = search.version;
  if (search.agent) out.agent = search.agent;
  if (search.run) out.run = search.run;
  if (search.q) out.q = search.q;
  return out;
}

/**
 * Open a prompt version in the URL.
 *
 * @param search - Current
 * @param prompt - Prompt name
 * @param version - Version
 */
export function openPromptVersion(search: AiSearch, prompt: string, version: number): AiSearch {
  return { ...search, prompt, version, agent: undefined, run: undefined };
}

/**
 * Open an agent run in the URL.
 *
 * @param search - Current
 * @param agent - Agent name
 * @param run - Run id
 */
export function openAgentRun(search: AiSearch, agent: string, run: string): AiSearch {
  return { ...search, agent, run };
}

/**
 * Manifest Diff href for a prompt version bump (do not duplicate Diff UI).
 *
 * @param manifestDiffPath - Path from projection (`/ai/prompts/…/version`)
 */
export function manifestDiffHref(manifestDiffPath: string): string {
  const params = new URLSearchParams({ path: manifestDiffPath });
  return `/manifest-diff?${params.toString()}`;
}
