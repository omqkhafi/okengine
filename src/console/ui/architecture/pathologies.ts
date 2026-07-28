/**
 * Architecture pathologies computed from the causality graph as data (§9.13).
 *
 * Cycles, god nodes, orphan signals, single points of failure —
 * surfaced as a findings list, not decoration on the diagram.
 */

import type { CausalityGraph } from "../flows/graph.ts";
import { declaredEdgesOf } from "./declared.ts";
import type { ArchitectureFinding } from "./types.ts";

/**
 * Compute all architecture findings for a causality graph.
 *
 * @param graph - Flows causality graph
 */
export function computePathologies(graph: CausalityGraph): ArchitectureFinding[] {
  const findings: ArchitectureFinding[] = [];
  findings.push(...findCycles(graph));
  findings.push(...findGodNodes(graph));
  findings.push(...findOrphanSignals(graph));
  findings.push(...findSinglePointsOfFailure(graph));
  return findings;
}

/**
 * Directed cycles among flows (calls + signal producer→consumer).
 *
 * @param graph - Causality graph
 */
export function findCycles(graph: CausalityGraph): ArchitectureFinding[] {
  const adj = new Map<string, Set<string>>();
  const ensure = (id: string): Set<string> => {
    let set = adj.get(id);
    if (!set) {
      set = new Set();
      adj.set(id, set);
    }
    return set;
  };

  for (const edge of declaredEdgesOf(graph)) {
    if (!edge.from.startsWith("flow:") || !edge.to.startsWith("flow:")) {
      continue;
    }
    const from = edge.from.slice("flow:".length);
    const to = edge.to.slice("flow:".length);
    ensure(from).add(to);
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  const dfs = (node: string): void => {
    visited.add(node);
    stack.push(node);
    onStack.add(node);
    for (const next of adj.get(node) ?? []) {
      if (!visited.has(next)) {
        dfs(next);
      } else if (onStack.has(next)) {
        const idx = stack.indexOf(next);
        if (idx !== -1) {
          cycles.push([...stack.slice(idx), next]);
        }
      }
    }
    stack.pop();
    onStack.delete(node);
  };

  for (const id of graph.flows.map((f) => f.id)) {
    if (!visited.has(id)) dfs(id);
  }

  // Deduplicate by normalised cycle signature
  const seen = new Set<string>();
  const findings: ArchitectureFinding[] = [];
  for (const cycle of cycles) {
    const body = cycle.slice(0, -1);
    const rotated = rotateMin(body);
    const sig = rotated.join("→");
    if (seen.has(sig)) continue;
    seen.add(sig);
    findings.push({
      kind: "cycle",
      severity: "critical",
      title: "Cycle",
      detail: `Causal cycle: ${rotated.join(" → ")}`,
      nodeIds: rotated.map((id) => `flow:${id}`),
    });
  }
  return findings;
}

/**
 * Resources touched by the most flows ("god nodes").
 *
 * @param graph - Causality graph
 */
export function findGodNodes(graph: CausalityGraph): ArchitectureFinding[] {
  if (graph.effects.length === 0) return [];
  const ranked = [...graph.effects]
    .filter((e) => e.touchCount > 0)
    .sort((a, b) => b.touchCount - a.touchCount || a.ref.localeCompare(b.ref));
  const top = ranked[0];
  if (!top || top.touchCount < 2) return [];

  // Only flag when clearly dominant (strictly more than the runner-up, or sole)
  const second = ranked[1]?.touchCount ?? 0;
  if (
    top.touchCount === second &&
    ranked.filter((e) => e.touchCount === top.touchCount).length > 1
  ) {
    // Tie for first — report all tied gods
    return ranked
      .filter((e) => e.touchCount === top.touchCount)
      .map((e) => ({
        kind: "god-node" as const,
        severity: "warning" as const,
        title: "God node",
        detail: `${e.ref} is touched by ${e.touchCount} flows — the most in the system`,
        nodeIds: [e.ref],
      }));
  }

  return [
    {
      kind: "god-node",
      severity: "warning",
      title: "God node",
      detail: `${top.ref} is touched by ${top.touchCount} flows — the most in the system`,
      nodeIds: [top.ref],
    },
  ];
}

/**
 * Orphan signals: declared but never emitted, never consumed, or both sides missing.
 *
 * @param graph - Causality graph
 */
export function findOrphanSignals(graph: CausalityGraph): ArchitectureFinding[] {
  const findings: ArchitectureFinding[] = [];
  const signalNames = new Set<string>();

  for (const effect of graph.effects) {
    if (effect.ref.startsWith("signal:")) {
      signalNames.add(effect.ref.slice("signal:".length));
    }
  }
  for (const flow of graph.flows) {
    for (const sig of flow.raw.effects?.emits ?? []) signalNames.add(sig);
    const trigger = flow.raw.trigger?.signal;
    if (trigger) signalNames.add(trigger);
  }

  for (const name of [...signalNames].sort()) {
    const ref = `signal:${name}`;
    const emitters = graph.flows.filter((f) => (f.raw.effects?.emits ?? []).includes(name));
    const consumers = graph.flows.filter((f) => f.raw.trigger?.signal === name);

    if (emitters.length === 0 && consumers.length === 0) {
      findings.push({
        kind: "orphan-signal",
        severity: "warning",
        title: "Orphan signal",
        detail: `${name} is declared but has no producers and no consumers`,
        nodeIds: [ref],
      });
      continue;
    }
    if (emitters.length === 0) {
      findings.push({
        kind: "orphan-signal",
        severity: "warning",
        title: "Orphan signal",
        detail: `${name} has consumers but no producer`,
        nodeIds: [ref, ...consumers.map((c) => `flow:${c.id}`)],
      });
      continue;
    }
    if (consumers.length === 0) {
      findings.push({
        kind: "orphan-signal",
        severity: "warning",
        title: "Orphan signal",
        detail: `${name} is emitted but has no consumers`,
        nodeIds: [ref, ...emitters.map((e) => `flow:${e.id}`)],
      });
    }
  }

  return findings;
}

/**
 * Single points of failure: widely-touched resources with exactly one writer/emitter.
 *
 * @param graph - Causality graph
 */
export function findSinglePointsOfFailure(graph: CausalityGraph): ArchitectureFinding[] {
  const findings: ArchitectureFinding[] = [];

  for (const effect of graph.effects) {
    if (effect.touchCount < 2) continue;
    if (effect.ref.startsWith("secret:")) continue;
    if (effect.ref.startsWith("channel:") || effect.ref.startsWith("ai:")) {
      continue;
    }

    const writers = effect.flowIds.filter((id) => {
      const flow = graph.flowById.get(id);
      if (!flow?.raw.effects) return false;
      if (effect.ref.startsWith("signal:")) {
        const name = effect.ref.slice("signal:".length);
        return (flow.raw.effects.emits ?? []).includes(name);
      }
      return (flow.raw.effects.writes ?? []).includes(effect.ref);
    });

    if (writers.length !== 1) continue;
    const writer = writers[0]!;
    findings.push({
      kind: "spof",
      severity: "critical",
      title: "Single point of failure",
      detail: `${effect.ref} is touched by ${effect.touchCount} flows but written/emitted by only ${writer}`,
      nodeIds: [effect.ref, `flow:${writer}`],
    });
  }

  return findings;
}

function rotateMin(cycle: readonly string[]): string[] {
  if (cycle.length === 0) return [];
  let best = [...cycle];
  let bestKey = best.join("\0");
  for (let i = 1; i < cycle.length; i++) {
    const rotated = [...cycle.slice(i), ...cycle.slice(0, i)];
    const key = rotated.join("\0");
    if (key < bestKey) {
      best = rotated;
      bestKey = key;
    }
  }
  return best;
}
