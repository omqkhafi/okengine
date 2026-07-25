/** Eight elements — from unified-theory §5 (essence + zoo they replace). */
export const ELEMENTS: ReadonlyArray<{
  readonly name: string;
  readonly essence: string;
  /** Short card description for Features / homepage. */
  readonly description: string;
  /** What this element replaces (from the §5 table). */
  readonly replaces: string;
  readonly href: string;
}> = [
  {
    name: 'Flow',
    essence: 'behavior',
    description: 'Endpoints, jobs, consumers, and workflows — one species.',
    replaces: 'endpoint · handler · consumer · job · workflow · webhook',
    href: '/docs/elements/flow',
  },
  {
    name: 'Signal',
    essence: 'data in motion',
    description: 'Queues, pub/sub, and streams — delivery is a property.',
    replaces: 'queue · pub/sub · stream · websocket · SSE · event bus',
    href: '/docs/elements/signal',
  },
  {
    name: 'Store',
    essence: 'data at rest',
    description: 'SQL, KV, files, and search index as one store surface.',
    replaces: 'database · cache · KV · file storage · search index',
    href: '/docs/elements/store',
  },
  {
    name: 'Clock',
    essence: 'time',
    description: 'Cron, delays, timeouts, and durable sleep.',
    replaces: 'cron · delay · timeout · durable sleep · TTL',
    href: '/docs/elements/clock',
  },
  {
    name: 'Gate',
    essence: 'permission to act',
    description: 'Auth, ABAC, rate limits, and feature flags at the trigger.',
    replaces: 'auth · session · ABAC · rate limit · quota · feature flag',
    href: '/docs/elements/gate',
  },
  {
    name: 'Vault',
    essence: 'protected knowledge',
    description: 'Secrets and config with typed contracts.',
    replaces: 'secrets · config · environment',
    href: '/docs/elements/vault',
  },
  {
    name: 'Channel',
    essence: 'reaching humans',
    description: 'Email, SMS, WhatsApp, push — consent and locale built in.',
    replaces: 'email · SMS · WhatsApp · push',
    href: '/docs/elements/channel',
  },
  {
    name: 'AI',
    essence: 'reaching machine intelligence',
    description: 'Models, prompts, agents, and RAG with cost and PII rules.',
    replaces: 'model calls · prompts · embeddings · agents · RAG',
    href: '/docs/elements/ai',
  },
];

/** Positioning line from unified-theory §3 — unchanged. */
export const POSITIONING =
  'OKE is the batteries-included TypeScript backend for the Bun era: contract-first APIs with end-to-end type safety, declarative infrastructure primitives, an OpenTelemetry-native Console, secure-by-default auth and ABAC — pure TypeScript, Web-Standards portable, MIT-licensed, self-hostable with zero cloud lock-in.';
