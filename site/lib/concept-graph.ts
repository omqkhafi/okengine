/**
 * Canonical Site Knowledge Model (Concept Graph).
 *
 * This module defines the formal conceptual model of OKEngine from which human
 * documentation, homepage narratives, AI/LLM routes, search indexes, and
 * architecture consistency tests are derived.
 *
 * The programming model stays small; operational surfaces are derived from it.
 */

/** The 8 closed core elements. An element earns its place only with irreducible physics. */
export const CANONICAL_ELEMENTS = [
  {
    id: "flow",
    name: "Flow",
    symbol: "Fl",
    essence: "Behavior",
    summary: "One species for endpoints, cron jobs, consumers, and workflows.",
    replaces: "endpoint · handler · consumer · job · workflow · webhook",
    primitiveKind: "behavior",
  },
  {
    id: "signal",
    name: "Signal",
    symbol: "Sg",
    essence: "Data in motion",
    summary: "Once, broadcast, and live — delivery physics are a property.",
    replaces: "queue · pub/sub · stream · websocket · SSE · event bus",
    primitiveKind: "transport",
  },
  {
    id: "store",
    name: "Store",
    symbol: "St",
    essence: "Data at rest",
    summary: "SQL, KV, files with image transforms, and search index under one surface.",
    replaces: "database · cache · KV · file storage · search index",
    primitiveKind: "persistence",
  },
  {
    id: "clock",
    name: "Clock",
    symbol: "Ck",
    essence: "Time",
    summary: "Schedules, intervals, durable sleeps, and time travel.",
    replaces: "cron · delay · timeout · durable sleep · TTL",
    primitiveKind: "temporal",
  },
  {
    id: "gate",
    name: "Gate",
    symbol: "Gt",
    essence: "Permission to act",
    summary: "Authentication, RBAC/ABAC, tenancy, and rate limits at the trigger.",
    replaces: "auth · session · ABAC · rate limit · quota · feature flag",
    primitiveKind: "boundary",
  },
  {
    id: "vault",
    name: "Vault",
    symbol: "Vt",
    essence: "Protected knowledge",
    summary: "Fail-loud secret contracts and encrypted configuration.",
    replaces: "secrets · config · environment",
    primitiveKind: "secrets",
  },
  {
    id: "channel",
    name: "Channel",
    symbol: "Ch",
    essence: "Reaching humans",
    summary: "Email, SMS, WhatsApp, and push with built-in consent and locale fallback.",
    replaces: "email · SMS · WhatsApp · push",
    primitiveKind: "human-outreach",
  },
  {
    id: "ai",
    name: "AI",
    symbol: "Ai",
    essence: "Reaching machine intelligence",
    summary: "Model calls, prompts, agents, and RAG with cost caps and PII boundaries.",
    replaces: "model calls · prompts · embeddings · agents · RAG",
    primitiveKind: "machine-intelligence",
  },
] as const;

export type CanonicalElementId = (typeof CANONICAL_ELEMENTS)[number]["id"];
export type CanonicalElementName = (typeof CANONICAL_ELEMENTS)[number]["name"];

/** Observable effect kinds recorded through fx. */
export const CANONICAL_EFFECTS = [
  { kind: "read", target: "Store facets, signal dead-letters, runs wide events" },
  { kind: "write", target: "Store mutations, API key lifecycle, tenant memberships" },
  { kind: "emit", target: "Signal outbox with parentRunId trace stamps" },
  { kind: "send", target: "Channel templates and provider/app OTP delivery" },
  { kind: "ask", target: "AI prompt evaluations, agent executions, model token streaming" },
  { kind: "secret", target: "Vault contract resolutions and redacted key reads" },
  { kind: "call", target: "Flow-to-flow composition and external MCP tool invocations" },
] as const;

export type CanonicalEffectKind = (typeof CANONICAL_EFFECTS)[number]["kind"];

/**
 * Four composition proofs — demonstrating how the eight closed elements
 * compose to produce Realtime, Security, Agents, and Operations without
 * inventing a ninth primitive or parallel subsystem.
 */
export const COMPOSITION_PROOFS = [
  {
    id: "realtime",
    title: "Realtime",
    elements: ["Store", "Gate", "Signal", "Flow"],
    formula: "Store + Gate + Signal + Flow → Live Query",
    mechanism:
      "Global CDC → Row-level security re-check → Signal SSE stream → useLiveQuery subscriber",
    proof:
      "Realtime is not a distinct engine; it emerges by composing Store writes, Gate RLS stamping, and Signal delivery physics.",
  },
  {
    id: "security",
    title: "Security & Tenancy",
    elements: ["Gate", "Store", "Vault", "Flow"],
    formula: "Gate + Store/RLS + Tenant + fx → Secure execution",
    mechanism:
      "API Keys / OAuth → Gate trigger boundary → Tenant RLS stamping → Least-privilege capability token",
    proof:
      "One security model spans users, operators, and agents with blast-radius diffs computed automatically on save.",
  },
  {
    id: "agents",
    title: "Agents & MCP",
    elements: ["Flow", "Gate", "AI"],
    formula: "MCP + Gate + OAuth + Flow → Agent-accessible backend",
    mechanism:
      "External Agent → Runtime MCP (:6535) → OAuth 2.1 AS / Gate check → Flow invocation via fx.call",
    proof:
      "MCP is a derived surface of the model, not the model itself. Agents invoke declared Flows through the same gate pipeline.",
  },
  {
    id: "operations",
    title: "Observability",
    elements: ["Flow", "Clock", "Channel"],
    formula: "Manifest + Effects + Runs → Inspectable backend",
    mechanism:
      "Compiled Manifest contract → fx effect ledger → Wide-event Runs store → Console (:6533) + oke doctor",
    proof:
      "Your backend is not just executable; it is structurally inspectable. Alerting is Runs + Clock + Channel without a second metrics zoo.",
  },
] as const;

/** Operational surfaces derived from the compiled Manifest contract. */
export const DERIVED_SURFACES_CATALOG = [
  {
    id: "client",
    surface: "Typed Client",
    consumer: "Frontend & Mobile apps",
    benefit: "End-to-end typed SDK with live queries (`useLiveQuery`) without manual codegen.",
  },
  {
    id: "console",
    surface: "Developer Console (:6533)",
    consumer: "Developers & Operators",
    benefit:
      "Interactive panels, effect traces, manifest diffs, and live architectural flow graphs.",
  },
  {
    id: "mcp-runtime",
    surface: "Runtime MCP (:6535)",
    consumer: "AI Agents (Cursor, Claude, Windsurf)",
    benefit:
      "Exposes declared Flows as MCP tools governed by Gate authorization and confirmation tokens.",
  },
  {
    id: "mcp-docs",
    surface: "Docs MCP (:6536)",
    consumer: "AI Agents & Assistants",
    benefit: "Local, version-pinned semantic documentation retrieval for agents.",
  },
  {
    id: "specs",
    surface: "OpenAPI & AsyncAPI",
    consumer: "API Gateways & Integrations",
    benefit: "Standardized API specifications derived from Flow contracts and trigger schemas.",
  },
  {
    id: "capabilities",
    surface: "Capability Matrix & Cache Keys",
    consumer: "Compiler & Runtime",
    benefit:
      "Inferred least-privilege tokens and automatic cache invalidation keys from fx reads/writes.",
  },
] as const;

/** Canonical dev ports allocated by `oke dev`. */
export const CANONICAL_PORTS = [
  { port: "6530", name: "Backend", role: "Flow HTTP and WebSocket runtime" },
  { port: "6533", name: "Console", role: "Operator UI, traces, effect graph, and doctor" },
  { port: "6535", name: "Runtime MCP", role: "Model Context Protocol for external agent access" },
  { port: "6536", name: "Docs MCP", role: "Read-only handbook search for AI agents" },
] as const;

/** Taxonomy definition establishing clear conceptual boundaries. */
export const TAXONOMY_RULES = {
  element: "One of the 8 closed core primitives. Defines the model.",
  plugin:
    "Extends what the model can do without expanding what the model is (e.g. auth, security headers, cors).",
  driver:
    "Protocol-level adapter connecting an element to infrastructure (e.g. postgres, redis, s3, sndr).",
  provider:
    "Managed/cloud infrastructure behind a driver (e.g. Neon, Supabase, Redis Cloud, Upstash).",
  recipe:
    "Self-hosted Docker/compose infrastructure behind a driver (e.g. Postgres, Valkey, Meilisearch, Ollama).",
  template: "A complete starter project (e.g. standard, advanced).",
} as const;
