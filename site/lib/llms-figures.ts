/**
 * Teaching-figure fallbacks for `/llms-full.txt`.
 *
 * Self-closing MDX figures carry their claim in `aria-label` for humans.
 * Agents never see that attribute — this map inlines the same sentence
 * as a blockquote so the dump stays information-complete.
 */

/** aria-label text keyed by JSX component name. */
export const TEACHING_FIGURE_FALLBACKS: Readonly<Record<string, string>> = {
  FlowTriggers:
    "Six triggers — HTTP, signal, interval, row change, fx.call, and an MCP tool — all binding to the same Flow species.",
  FlowDurable:
    "Durable journal physics: with durable true, killing the process after create-intent resumes at confirm and create-intent never re-runs; without a journal, a restart re-runs create-intent.",
  SignalDelivery:
    "Signal delivery physics: once — two workers compete and exactly one claims; broadcast — every subscriber gets a copy; live — a late bus.live() subscriber replays the full retained history.",
  SignalOnceLease:
    "On once, a claim sets lockedBy and leaseExpiresAt (default 30s); after expiry the next consumer reclaims the same message (at-least-once). No background sweeper.",
  SignalLiveReplay:
    "live retains every payload; a late bus.live() subscriber replays the full history (placed → fulfilling → shipped).",
  StoreFacets:
    "Four store facets — SQL tables, key-value cache, file blobs, and search index — behind one fx.store handle, drivers swapped per environment.",
  StoreKvTtl:
    "KV TTL physics: redis drains the TTL and expires the key; memory ignores TTL and the key stays.",
  StoreFilesVariants:
    "putImage fans one upload into the original object plus named variant keys; optional placeholder returns a ThumbHash data URL, not another object.",
  StoreIndexModes:
    "Index modes: vector drivers take embedding vectors and return cosine scores; meilisearch takes a text query and returns relevance scores. TypeScript keeps the two apart.",
  StoreSeeding:
    "oke db seed: essential always runs; dev lights the dev block; prod lights prod; test runs essential only. Upsert inserts once, then already-existed unless onExisting update.",
  ClockSchedules:
    "Two schedule kinds — every is a fixed interval, clock is a named cron or interval — both bind with on(trigger, flow) to the same Flow species.",
  ClockCatchUp:
    "Catch-up policy one: an hourly clock down for five hours reports missedRuns five and catchUp one, then a single tick runs the handler once — never a storm of five.",
  ClockSleep:
    "Durable sleep: fx.clock.sleep journals the wake time; after a restart the flow resumes at that step instead of losing its place.",
  GatePipeline:
    "Gate chain: member, canBook, and fair evaluate left to right. First denial wins — Unauthorized when anonymous, Forbidden when authenticated but a policy says no, RateLimited when the quota is burned. Later gates are skipped. do runs only when every gate passed.",
  VaultResolution:
    "Vault resolution chain: driver, process.env, .env.local, then dev-fallback. First hit wins; if every layer misses, boot fails with VaultBootError.",
  VaultRedacted:
    "Vault Redacted physics: fx.vault.get returns a Redacted wrapper so fx.log, String, and JSON show [redacted]; only .reveal() yields cleartext at the provider boundary.",
  ChannelPhysics:
    "Channel physics around one fx.send: consent can suppress before any provider; locale resolves then the catalog body falls back to the default or en; via orders same-medium driver ids with first success winning; every attempt lands on a receipt, with status fallback after recovery.",
  AiBlocks:
    "Four AI building blocks — model bindings, versioned prompts, embedding pipelines into store.index, and bounded agents whose tools are flows.",
  AiGuardrails:
    "AI guardrails: prompts are versioned typed artifacts, PII to third-party models fails the build unless acknowledged, agents are bounded by steps and budget, and there is no production model default.",
  AiPiiEgress:
    "PII egress physics: sending a .pii() field to anthropic fails the build without allowPii; the same ask against openai-compatible local is on-premise and proceeds.",
  SixSystemsDrift:
    "Evolution of a signup feature from 1 route file into 6 disparate subsystem files over 8 months in production.",
};

const STORE_FACET_PHYSICS: Readonly<Record<string, string>> = {
  sql: "sql facet — Single-table session — ops cycle through one row",
  kv: "kv facet — set → TTL drains → key expires",
  files: "files facet — put into the bucket, get the bytes back",
  index: "index facet — search fans out — hits ranked by score",
};

const STORE_FACET_MARK_RE = /<StoreFacetMark\s+facet="(\w+)"\s*\/>/g;
const VOID_FIGURE_RE = new RegExp(
  `<(${Object.keys(TEACHING_FIGURE_FALLBACKS).join("|")})(?:\\s[^>]*)?\\s*/>`,
  "g",
);

/**
 * Replace self-closing teaching figures with their aria-label as a blockquote.
 *
 * @param body - Frontmatter-stripped MDX
 */
export function expandTeachingFigures(body: string): string {
  const withMarks = body.replace(STORE_FACET_MARK_RE, (_m, facet: string) => {
    const text = STORE_FACET_PHYSICS[facet];
    return text ? `\n> ${text}\n` : _m;
  });
  return withMarks.replace(VOID_FIGURE_RE, (_m, name: string) => {
    const text = TEACHING_FIGURE_FALLBACKS[name];
    return text ? `\n> ${text}\n` : _m;
  });
}
