import type { LucideIcon } from "lucide-react";
import {
  Clock,
  Database,
  KeyRound,
  Mail,
  Radio,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
/** Preview fragment kind for Features cards (okengine extension). */
export type ElementPreviewKind =
  | "flow"
  | "signal"
  | "store"
  | "clock"
  | "gate"
  | "vault"
  | "channel"
  | "ai";

/** Eight elements — from unified-theory §5 (essence + zoo they replace). */
export const ELEMENTS: ReadonlyArray<{
  readonly name: string;
  /** Two-letter shorthand for the lattice visual — presentation only, not an API name. */
  readonly symbol: string;
  readonly essence: string;
  /** Short card description for Features / homepage. */
  readonly description: string;
  /** What this element replaces (from the §5 table). */
  readonly replaces: string;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly preview: ElementPreviewKind;
}> = [
  {
    name: "Flow",
    symbol: "Fl",
    essence: "behavior",
    description: "Endpoints, jobs, consumers, and workflows — one species.",
    replaces: "endpoint · handler · consumer · job · workflow · webhook",
    href: "/docs/elements/flow",
    icon: Workflow,
    preview: "flow",
  },
  {
    name: "Signal",
    symbol: "Sg",
    essence: "data in motion",
    description: "Queues, pub/sub, and streams — delivery is a property.",
    replaces: "queue · pub/sub · stream · websocket · SSE · event bus",
    href: "/docs/elements/signal",
    icon: Radio,
    preview: "signal",
  },
  {
    name: "Store",
    symbol: "St",
    essence: "data at rest",
    description: "SQL, KV, files with image transforms, and search — one surface.",
    replaces: "database · cache · KV · file storage · search index",
    href: "/docs/elements/store",
    icon: Database,
    preview: "store",
  },
  {
    name: "Clock",
    symbol: "Ck",
    essence: "time",
    description: "Cron, delays, timeouts, and durable sleep.",
    replaces: "cron · delay · timeout · durable sleep · TTL",
    href: "/docs/elements/clock",
    icon: Clock,
    preview: "clock",
  },
  {
    name: "Gate",
    symbol: "Gt",
    essence: "permission to act",
    description: "Auth, ABAC, rate limits, and feature flags at the trigger.",
    replaces: "auth · session · ABAC · rate limit · quota · feature flag",
    href: "/docs/elements/gate",
    icon: ShieldCheck,
    preview: "gate",
  },
  {
    name: "Vault",
    symbol: "Vt",
    essence: "protected knowledge",
    description: "Secrets and config with typed contracts.",
    replaces: "secrets · config · environment",
    href: "/docs/elements/vault",
    icon: KeyRound,
    preview: "vault",
  },
  {
    name: "Channel",
    symbol: "Ch",
    essence: "reaching humans",
    description: "Email, SMS, WhatsApp, push — consent and locale built in.",
    replaces: "email · SMS · WhatsApp · push",
    href: "/docs/elements/channel",
    icon: Mail,
    preview: "channel",
  },
  {
    name: "AI",
    symbol: "Ai",
    essence: "reaching machine intelligence",
    description: "Models, prompts, agents, and RAG with cost and PII rules.",
    replaces: "model calls · prompts · embeddings · agents · RAG",
    href: "/docs/elements/ai",
    icon: Sparkles,
    preview: "ai",
  },
];

/**
 * Short homepage tagline — §3 facts, rewritten for scannability
 * (not a new claim).
 */
export const TAGLINE =
  "Stop gluing APIs, jobs, and queues into one backend. One law collapses them — client, Console, and infra come free. Yours to host.";

/** Full positioning sentence from unified-theory §3 (docs that need the long form). */
export const POSITIONING =
  "OKE is the batteries-included TypeScript backend for the Bun era: contract-first APIs with end-to-end type safety, declarative infrastructure primitives, an OpenTelemetry-native Console, secure-by-default auth and ABAC — pure TypeScript, Web-Standards portable, MIT-licensed, self-hostable with zero cloud lock-in.";

/** Published `okengine` version (injected from the monorepo root package.json). */
export const OKE_VERSION = process.env.NEXT_PUBLIC_OKE_VERSION ?? "0.0.0";

/**
 * Honest “what’s real today” facts — not growth metrics.
 * Presentation (brand marks / ink) lives in the hero; this is just the labels.
 */
export const REAL_TODAY: ReadonlyArray<{
  readonly id: "backend" | "typescript" | "version";
  readonly label: string;
}> = [
  { id: "typescript", label: "TypeScript" },
  { id: "backend", label: "Backend" },
  { id: "version", label: `v${OKE_VERSION}` },
];

/**
 * The ten exports — the entire public vocabulary (unified-theory §6).
 * Order matches the canonical import statement.
 */
export const EXPORTS: ReadonlyArray<{
  readonly name: string;
  readonly role: string;
}> = [
  { name: "on", role: "bind a trigger to a flow" },
  { name: "flow", role: "define behavior + contracts" },
  { name: "signal", role: "data in motion" },
  { name: "store", role: "data at rest" },
  { name: "clock", role: "time" },
  { name: "gate", role: "permission to act" },
  { name: "vault", role: "secrets and config" },
  { name: "channel", role: "reach humans" },
  { name: "ai", role: "reach models and agents" },
  { name: "plugin", role: "extend without a ninth element" },
];

/** Dev surfaces that come up together — mnemonic O·K·E = 6·5·3. */
export const PORTS: ReadonlyArray<{
  readonly port: string;
  readonly surface: string;
  readonly detail: string;
}> = [
  { port: "6530", surface: "Backend", detail: "Your flows, served from the Manifest." },
  { port: "6533", surface: "Console", detail: "Panels, traces, and the effect graph." },
  { port: "6535", surface: "MCP", detail: "The same Manifest, for agents." },
  { port: "6536", surface: "Docs MCP", detail: "Read-only docs search for agents." },
];

/** Separator the §5 `replaces` lists use between concerns. */
const REPLACES_SEPARATOR = " · ";

/**
 * One concern the zoo makes you own, and the element that subsumes it.
 */
export type ZooConcern = {
  readonly label: string;
  readonly element: string;
};

/**
 * Every concern the eight elements replace, in element order — the `replaces`
 * lists above flattened, nothing added and nothing sampled. Counting the §5
 * table gives forty, so the diagram that draws this array draws the whole
 * claim; deriving it here is what stops the drawn set and the stated total
 * from ever disagreeing.
 */
export const ZOO_CONCERNS: ReadonlyArray<ZooConcern> = ELEMENTS.flatMap((element) =>
  element.replaces.split(REPLACES_SEPARATOR).map((label) => ({ label, element: element.name })),
);

/**
 * The concerns of one element, as a contiguous run of `ZOO_CONCERNS`.
 *
 * The diagram leans on the contiguity twice: the ring draws each element as its
 * own arc, and the stepped pass adds exactly one group per step, so the zoo
 * gains a cluster of concerns while the hub side gains a single trunk.
 */
export type ZooConcernGroup = {
  readonly element: string;
  /** Ring position of the group's first concern. */
  readonly start: number;
  /** Concerns present once this group has arrived — the group's exclusive end. */
  readonly end: number;
};

/** The eight runs of `ZOO_CONCERNS`, one per element, in ring order. */
export const ZOO_CONCERN_GROUPS: ReadonlyArray<ZooConcernGroup> = ELEMENTS.reduce<
  ZooConcernGroup[]
>((groups, element) => {
  const start = groups[groups.length - 1]?.end ?? 0;
  const size = element.replaces.split(REPLACES_SEPARATOR).length;
  groups.push({ element: element.name, start, end: start + size });
  return groups;
}, []);

/**
 * What your code declares that the compiler can read — the inputs to Manifest
 * extraction. Names match the real `fx` surface.
 */
export const MANIFEST_INPUTS: ReadonlyArray<{
  readonly syntax: string;
  readonly records: string;
}> = [
  { syntax: "on(trigger)", records: "triggers" },
  { syntax: "flow(name, { in, out, errors })", records: "contracts" },
  { syntax: "fx.store · fx.emit · fx.vault · fx.ask", records: "effects" },
  { syntax: ".gate(…)", records: "permissions" },
];

/** Top-level keys of `manifest.oke.json` (unified-theory §8, four-applications REFERENCE). */
export const MANIFEST_TOP_LEVEL_KEYS: ReadonlyArray<string> = [
  "flows",
  "signals",
  "channels",
  "ai",
  "journeys",
  "drivers",
  "tenancy",
];

/** Keys recorded per flow inside the Manifest. */
export const MANIFEST_FLOW_KEYS: ReadonlyArray<string> = [
  "trigger",
  "gates",
  "in",
  "out",
  "errors",
  "effects",
  "slo",
  "source",
];

/**
 * Surfaces derived from `manifest.oke.json` (unified-theory §8), grouped by who
 * consumes them so the list stays scannable.
 */
export const DERIVED_SURFACE_GROUPS: ReadonlyArray<{
  readonly label: string;
  readonly surfaces: ReadonlyArray<string>;
}> = [
  {
    label: "client & docs",
    surfaces: ["typed client (+ live queries)", "OpenAPI + AsyncAPI + docs"],
  },
  {
    label: "console & agents",
    surfaces: ["Console panels + traces", "architecture diagram", "MCP surface for agents"],
  },
  {
    label: "build & runtime",
    surfaces: ["capability matrix", "cache invalidation keys", "Dockerfile + compose"],
  },
];

/** Flat list of derived surfaces — kept in sync by deriving it from the groups. */
export const DERIVED_SURFACES: ReadonlyArray<string> = DERIVED_SURFACE_GROUPS.flatMap(
  (group) => group.surfaces,
);
