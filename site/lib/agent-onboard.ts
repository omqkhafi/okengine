/**
 * Homepage AI-onboarding prompt — points an agent at the full project context
 * in one shot (docs index + agent contract). Distinct from per-page copy-prompt.
 */

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
 * Fetchable URL for the agent contract served by this site (`/llms/agents`).
 *
 * @param origin - Site origin; defaults to the live docs host
 */
export function agentsMdUrl(origin: string = DOCS_ORIGIN): string {
  return `${origin.replace(/\/$/, "")}/llms/agents`;
}

/**
 * Short bootstrap prompt — same shape as a one-line “read these two files” cue.
 *
 * @param origin - Docs origin for `/llms.txt` (use `window.location.origin` in the browser)
 */
export function agentOnboardPrompt(origin: string = DOCS_ORIGIN): string {
  return `Read ${llmsTxtUrl(origin)} and ${agentsMdUrl(origin)}…`;
}
