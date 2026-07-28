/**
 * The zoo's seams — which of the concerns in `ZOO_CONCERNS` actually have to
 * know about each other, and the counts derived from that.
 *
 * The landing diagram used to draw a complete graph, one edge per pair. That
 * flattered the argument and was not true: a real backend's `cache` does not
 * integrate with its `WhatsApp` sender. So the seams are curated here instead —
 * one pair per line, each one a wiring, credential, invalidation, or ordering
 * problem an engineer would recognise — and every number the diagram puts on
 * screen is counted from this list rather than from a formula.
 *
 * The argument survives the honesty, because it never depended on the formula:
 * each new concern lands on several concerns already present, so the seams you
 * own outgrow the concerns you added, and one change re-checks every seam its
 * concern owns. In the okengine shape a concern owns exactly one spoke and its
 * element already holds the trunk, so one change is always two edges.
 *
 * Each pair is listed once, under the concern that most obviously owns it, so a
 * reviewer can read one block and judge one concern's integration surface. The
 * block comments say why the pairs are there; where a pair could sit under
 * either end, it sits under the one that goes first in ring order.
 *
 * This module is pure and free of React so `lib/zoo-graph.test.ts` can hold the
 * data to the claims the diagram makes about it.
 */

import { ZOO_CONCERNS } from "./elements";

/**
 * Curated seams between the forty concerns, grouped by the concern that most
 * obviously owns each one. Order inside the list is presentational only — the
 * diagram resolves, sorts, and de-duplicates every pair.
 */
export const ZOO_SEAMS: ReadonlyArray<readonly [string, string]> = [
  // endpoint — the request path touches nearly everything on its way through.
  ["endpoint", "handler"],
  ["endpoint", "auth"],
  ["endpoint", "session"],
  ["endpoint", "rate limit"],
  ["endpoint", "feature flag"],
  ["endpoint", "timeout"],
  ["endpoint", "database"],
  ["endpoint", "cache"],
  ["endpoint", "file storage"],
  ["endpoint", "queue"],
  ["endpoint", "websocket"],
  ["endpoint", "SSE"],
  ["endpoint", "config"],

  // handler — the same logic, reachable four ways, each with its own signature.
  ["handler", "consumer"],
  ["handler", "webhook"],
  ["handler", "event bus"],
  ["handler", "ABAC"],

  // consumer — delivery semantics leak into the code that receives them.
  ["consumer", "queue"],
  ["consumer", "pub/sub"],
  ["consumer", "event bus"],
  ["consumer", "job"],
  ["consumer", "database"],
  ["consumer", "timeout"],
  ["consumer", "delay"],

  // job — a worker is a second runtime with the same appetite as the first.
  ["job", "workflow"],
  ["job", "cron"],
  ["job", "queue"],
  ["job", "database"],
  ["job", "cache"],
  ["job", "file storage"],
  ["job", "durable sleep"],
  ["job", "email"],
  ["job", "model calls"],

  // workflow — long-running state that has to survive a deploy.
  ["workflow", "queue"],
  ["workflow", "event bus"],
  ["workflow", "database"],
  ["workflow", "timeout"],
  ["workflow", "durable sleep"],
  ["workflow", "agents"],

  // webhook — somebody else's retry policy, arriving at your front door.
  ["webhook", "queue"],
  ["webhook", "event bus"],
  ["webhook", "secrets"],
  ["webhook", "rate limit"],
  ["webhook", "delay"],
  ["webhook", "WhatsApp"],

  // queue — ordering, de-duplication, and the outbox that keeps it honest.
  ["queue", "event bus"],
  ["queue", "database"],
  ["queue", "delay"],
  ["queue", "secrets"],

  // pub/sub — fan-out, and the second copy of every payload schema.
  ["pub/sub", "stream"],
  ["pub/sub", "websocket"],
  ["pub/sub", "event bus"],
  ["pub/sub", "cache"],

  // stream — a replayable log everything downstream wants to tail.
  ["stream", "websocket"],
  ["stream", "SSE"],
  ["stream", "database"],
  ["stream", "search index"],
  ["stream", "embeddings"],

  // websocket — a long-lived connection still needs the short-lived answers.
  ["websocket", "auth"],
  ["websocket", "session"],
  ["websocket", "KV"],
  ["websocket", "timeout"],
  ["websocket", "rate limit"],
  ["websocket", "push"],

  // SSE — an endpoint that never closes, and every proxy in between.
  ["SSE", "timeout"],
  ["SSE", "model calls"],

  // event bus — the routing table nobody owns.
  // (Every seam it has is listed above, under the producer that emits into it.)

  // database — every other concern eventually reads or writes it.
  ["database", "cache"],
  ["database", "search index"],
  ["database", "file storage"],
  ["database", "cron"],
  ["database", "auth"],
  ["database", "ABAC"],
  ["database", "secrets"],
  ["database", "email"],
  ["database", "embeddings"],

  // cache — invalidation is the seam, and it is never local.
  ["cache", "KV"],
  ["cache", "TTL"],
  ["cache", "ABAC"],
  ["cache", "rate limit"],
  ["cache", "feature flag"],
  ["cache", "model calls"],

  // KV — the same Redis, four mental models deep.
  ["KV", "TTL"],
  ["KV", "session"],
  ["KV", "quota"],
  ["KV", "push"],

  // file storage — bytes that outlive the row that points at them.
  ["file storage", "search index"],
  ["file storage", "TTL"],
  ["file storage", "ABAC"],
  ["file storage", "secrets"],
  ["file storage", "RAG"],

  // search index — a second copy of the truth, always slightly behind.
  ["search index", "cron"],
  ["search index", "ABAC"],
  ["search index", "embeddings"],
  ["search index", "RAG"],

  // cron — the schedule is upstream of the work it starts.
  ["cron", "TTL"],
  ["cron", "quota"],
  ["cron", "environment"],
  ["cron", "email"],

  // delay — backoff, and who is allowed to decide it.
  ["delay", "rate limit"],

  // timeout — four budgets that have to nest, declared in four places.
  ["timeout", "model calls"],

  // durable sleep — waiting is state, and state has an owner.
  ["durable sleep", "agents"],

  // TTL — expiry, spelled differently by every system that has it.
  ["TTL", "session"],
  ["TTL", "rate limit"],
  ["TTL", "push"],

  // auth — identity is an input to permission, and to the mail about it.
  ["auth", "session"],
  ["auth", "ABAC"],
  ["auth", "secrets"],
  ["auth", "email"],
  ["auth", "SMS"],

  // session — one login, remembered in three places.
  ["session", "environment"],

  // ABAC — the policy you write twice: once in code, once in the query.
  ["ABAC", "feature flag"],
  ["ABAC", "agents"],

  // rate limit — every budget in the system, on a different clock.
  ["rate limit", "quota"],
  ["rate limit", "model calls"],
  ["rate limit", "SMS"],

  // quota — the meter, the reset, and the mail when it runs out.
  ["quota", "feature flag"],
  ["quota", "email"],
  ["quota", "model calls"],

  // feature flag — a second answer to "may this happen", on its own dashboard.
  ["feature flag", "config"],
  ["feature flag", "environment"],
  ["feature flag", "prompts"],

  // secrets — every credential belongs to something.
  ["secrets", "config"],
  ["secrets", "environment"],
  ["secrets", "email"],
  ["secrets", "model calls"],

  // config — the values that are not secret, in a file that is not the same file.
  ["config", "environment"],
  ["config", "prompts"],

  // environment — the axis every one of the above has to be sliced along.
  // (Its seams are listed above, under the concern that varies per environment.)

  // email — the fallback chain starts here and ends somewhere else.
  ["email", "SMS"],
  ["email", "push"],

  // SMS — one phone number, two products, one consent record.
  ["SMS", "WhatsApp"],

  // push — the notification you must not send twice.
  // (Its seams are listed above, under websocket, KV, TTL, and email.)

  // model calls — non-determinism with a price per token.
  ["model calls", "prompts"],
  ["model calls", "agents"],

  // prompts — versioned artifacts that behave like code and ship like config.
  ["prompts", "agents"],
  ["prompts", "RAG"],

  // embeddings — a derived copy that has to be rebuilt when the model changes.
  ["embeddings", "RAG"],

  // agents — a workflow that decides its own next step.
  ["agents", "RAG"],
];

/** One seam, resolved to ring positions with `a` before `b`. */
export type ZooSeam = {
  readonly a: number;
  readonly b: number;
  /** Stable identity for React keys and lane lookups. */
  readonly key: string;
};

/**
 * Ring position of a concern label.
 *
 * @param label - Label that must appear in `ZOO_CONCERNS`
 * @throws If the label is not a known concern — a typo in `ZOO_SEAMS` would
 * otherwise silently drop a seam and quietly change every number on screen.
 */
function positionOf(label: string): number {
  const index = ZOO_CONCERNS.findIndex((concern) => concern.label === label);
  if (index < 0) {
    throw new Error(`zoo-graph: "${label}" is not one of the ZOO_CONCERNS`);
  }
  return index;
}

/**
 * The curated seams as ring positions, sorted so `b` is always the concern that
 * arrives later. The diagram leans on that: a step's new edges are exactly the
 * ones whose `b` is in the group that just arrived, which is what lets them
 * grow out of it.
 */
export const ZOO_SEAM_PAIRS: ReadonlyArray<ZooSeam> = ZOO_SEAMS.map(([from, to]) => {
  const first = positionOf(from);
  const second = positionOf(to);
  if (first === second) {
    throw new Error(`zoo-graph: "${from}" cannot have a seam with itself`);
  }
  const a = Math.min(first, second);
  const b = Math.max(first, second);
  return { a, b, key: `${a}-${b}` };
}).sort((left, right) => left.b - right.b || left.a - right.a);

/**
 * Seams and per-concern degrees at one width of the ring.
 *
 * Memoised per `visible` because the diagram asks for the busiest node, the
 * pass cost, and forty `aria-label`s on every frame, and a hundred-odd seams
 * scanned once per question is work the render loop does not need to repeat.
 */
const AT: Map<number, { seams: ReadonlyArray<ZooSeam>; degrees: ReadonlyArray<number> }> =
  new Map();

function stateAt(visible: number) {
  const cached = AT.get(visible);
  if (cached) return cached;
  const seams = ZOO_SEAM_PAIRS.filter((seam) => seam.b < visible);
  const degrees = new Array<number>(ZOO_CONCERNS.length).fill(0);
  for (const seam of seams) {
    degrees[seam.a] += 1;
    degrees[seam.b] += 1;
  }
  const state = { seams, degrees };
  AT.set(visible, state);
  return state;
}

/** Seams present once `visible` concerns have arrived. */
export function zooSeamsAt(visible: number): ReadonlyArray<ZooSeam> {
  return stateAt(visible).seams;
}

/** How many seams the zoo owns at `visible` concerns. */
export function zooSeamCount(visible: number): number {
  return stateAt(visible).seams.length;
}

/** Seams the concern at ring position `index` owns at `visible` concerns. */
export function zooSeamsOf(index: number, visible: number): ReadonlyArray<ZooSeam> {
  return stateAt(visible).seams.filter((seam) => seam.a === index || seam.b === index);
}

/** How many seams one concern owns — what a change to it has to re-check. */
export function zooDegree(index: number, visible: number): number {
  return stateAt(visible).degrees[index] ?? 0;
}

/** The concern that owns the most seams at `visible`, and how many. */
export function zooBusiest(visible: number): { readonly label: string; readonly seams: number } {
  const { degrees } = stateAt(visible);
  let label = ZOO_CONCERNS[0]!.label;
  let seams = -1;
  for (let index = 0; index < visible; index += 1) {
    const degree = degrees[index]!;
    if (degree > seams) {
      seams = degree;
      label = ZOO_CONCERNS[index]!.label;
    }
  }
  return { label, seams: Math.max(0, seams) };
}

/**
 * Seam re-checks if every concern present changed once — the sum of the degrees,
 * which is twice the seam count. The okengine comparison is `2 × visible`,
 * because a concern there owns one spoke and its element already holds the
 * trunk.
 */
export function zooPassCost(visible: number): number {
  return zooSeamCount(visible) * 2;
}

/**
 * Edges in the okengine shape: one spoke per concern, plus one trunk per
 * element those concerns land on. Unchanged by the curation — the collapse was
 * never a claim about the zoo's density.
 */
export function treeEdgeCount(visible: number): number {
  const elements = new Set(ZOO_CONCERNS.slice(0, visible).map((concern) => concern.element));
  return visible + elements.size;
}

/** Edges one change costs in the okengine shape: its spoke, and the trunk. */
export const TREE_CHANGE_COST = 2;
