/**
 * Shared ui-next seed — same Manifest + WideEvents used by Playwright and
 * `bun run dev:console-next:seed` so manual browser exploration matches CI.
 *
 * Lives beside the Vite kernel plugin (root `tsc` include) — not under
 * `src/console/ui/**`, which root typecheck excludes as the legacy SPA tree.
 *
 * Seed story (keel): a featured github→create→notify chain, a full CRUD +
 * custom-route HTTP surface, plus ~70 operational traces so Traces looks
 * like a live Linear-shaped workspace (50–100 band).
 */

import type { VaultLayerSeed } from "../server/vault.ts";
import type { RunsStore, WideEvent } from "../../runs/types.ts";
import {
  createUiNextSeedRuns,
  UI_NEXT_SEED_OPERATION_COUNT,
  UI_NEXT_SEED_RUN_ID,
  UI_NEXT_SEED_TOTAL_COUNT,
} from "./ui-next-seed-runs.ts";
import { UI_NEXT_SEED_STORE_COUNTS } from "./ui-next-seed-store.ts";
export { UI_NEXT_SEEDED_MANIFEST } from "./ui-next-seed-manifest.ts";
export {
  createUiNextOperationRuns,
  createUiNextSeedRun,
  createUiNextSeedRuns,
  UI_NEXT_SEED_CYCLES_RUN_ID,
  UI_NEXT_SEED_DRAFTS_RUN_ID,
  UI_NEXT_SEED_FAIL_RUN_ID,
  UI_NEXT_SEED_FEATURED_COUNT,
  UI_NEXT_SEED_INGEST_RUN_ID,
  UI_NEXT_SEED_LIST_RUN_ID,
  UI_NEXT_SEED_NOTIFY_RUN_ID,
  UI_NEXT_SEED_OPERATION_COUNT,
  UI_NEXT_SEED_RUN_ID,
  UI_NEXT_SEED_TOTAL_COUNT,
  UI_NEXT_SEED_TRIAGE_RUN_ID,
} from "./ui-next-seed-runs.ts";
export { seedUiNextStoreData, UI_NEXT_SEED_STORE_COUNTS } from "./ui-next-seed-store.ts";

/**
 * Append the full ui-next seed WideEvent chain to a Console runs store.
 *
 * @param runs - Booted Console runs store
 * @param now - Clock ms
 */
export async function appendUiNextSeedRun(
  runs: Pick<RunsStore, "append">,
  now: number = Date.now(),
): Promise<readonly WideEvent[]> {
  const seeds = createUiNextSeedRuns(now);
  for (const seed of seeds) {
    await runs.append(seed);
  }
  return seeds;
}

/**
 * Cleartext values for seeded `vault.config`.
 */
export const UI_NEXT_SEED_VAULT_CONFIG = {
  PUBLIC_APP_URL: "http://127.0.0.1:6530",
  PUBLIC_API_URL: "http://127.0.0.1:6530/api",
  PUBLIC_DOCS_URL: "http://127.0.0.1:3000/docs",
  KEEL_WORKSPACE: "keel",
} as const;

/** Process.env-won public origin — alias of {@link UI_NEXT_SEED_VAULT_CONFIG}. */
export const UI_NEXT_SEED_PUBLIC_APP_URL = UI_NEXT_SEED_VAULT_CONFIG.PUBLIC_APP_URL;

/**
 * Per-layer seed — real keel contracts, one winner each. The `.env.local`
 * overlay is in-memory — it does not write the project file.
 */
export const UI_NEXT_SEED_VAULT_LAYERS: VaultLayerSeed = {
  driver: {
    GITHUB_TOKEN: "ghp_seed_keel_github_sync",
    OPENAI_KEY: "sk-seed-keel-triage",
    PUBLIC_API_URL: UI_NEXT_SEED_VAULT_CONFIG.PUBLIC_API_URL,
  },
  processEnv: {
    PUBLIC_APP_URL: UI_NEXT_SEED_VAULT_CONFIG.PUBLIC_APP_URL,
    KEEL_WORKSPACE: UI_NEXT_SEED_VAULT_CONFIG.KEEL_WORKSPACE,
    WEBHOOK_SECRET: "whsec_seed_keel_outbound",
  },
  envLocal: {
    SLACK_WEBHOOK: "https://hooks.slack.test/keel/cycle-digest",
    PUBLIC_DOCS_URL: UI_NEXT_SEED_VAULT_CONFIG.PUBLIC_DOCS_URL,
  },
  devFallback: {
    SLACK_BOT: "xoxb-seed-keel-intake",
  },
};

/**
 * Pin process.env-won config when unset. Does not overwrite an
 * operator-supplied value.
 */
export function applyUiNextSeedVaultEnv(): void {
  for (const [name, value] of Object.entries(UI_NEXT_SEED_VAULT_LAYERS.processEnv ?? {})) {
    const current = process.env[name];
    if (current === undefined || current === "") process.env[name] = value;
  }
}

/**
 * True when `OKE_CONSOLE_NEXT_SEEDED=1` (seeded `dev:console-next:seed` mode).
 */
export function isConsoleNextSeeded(): boolean {
  return process.env["OKE_CONSOLE_NEXT_SEEDED"] === "1";
}

/**
 * One-line description of what seeded mode preloads.
 */
export function uiNextSeededSummary(): string {
  return (
    `keel graph (all 8 elements) + ${UI_NEXT_SEED_TOTAL_COUNT} traces ` +
    `(featured chain + AI triage + clocks + ${UI_NEXT_SEED_OPERATION_COUNT} ops) + ` +
    `${UI_NEXT_SEED_STORE_COUNTS.sqlIssues} issues — ` +
    `click ${UI_NEXT_SEED_RUN_ID} to highlight the chain`
  );
}
