/**
 * Homepage AI-onboarding prompt — points an agent at the full project context
 * in one shot (docs index + agent contract). Distinct from per-page copy-prompt.
 */

import { gitConfig } from "@/lib/shared";

/** Canonical public docs origin (matches `metadataBase` / llms.txt examples). */
export const DOCS_ORIGIN = "https://oke.omqkhafi.dev" as const;

/**
 * Absolute URL for the machine-readable docs index.
 *
 * @param origin - Site origin; defaults to the live docs host
 */
export function llmsTxtUrl(origin: string = DOCS_ORIGIN): string {
  return `${origin.replace(/\/$/, "")}/llms.txt`;
}

/**
 * Fetchable URL for the repo-root `AGENTS.md` contract (plain text, not HTML).
 */
export function agentsMdUrl(): string {
  return `https://raw.githubusercontent.com/${gitConfig.user}/${gitConfig.repo}/${gitConfig.branch}/AGENTS.md`;
}

/**
 * Short bootstrap prompt — same shape as a one-line “read these two files” cue.
 *
 * @param origin - Docs origin for `/llms.txt` (use `window.location.origin` in the browser)
 */
export function agentOnboardPrompt(origin: string = DOCS_ORIGIN): string {
  return `Read ${llmsTxtUrl(origin)} and ${agentsMdUrl()}…`;
}
