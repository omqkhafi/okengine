/**
 * Deterministic layout for the architecture SVG (console §9.13).
 *
 * Units sit inside the system boundary; external nodes sit outside.
 */

import type { ArchitectureNode } from "./types.ts";

/** Pixel position for a diagram node. */
export interface NodePosition {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** Boundary rectangle in SVG user units. */
export interface BoundaryRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Fixed boundary geometry. */
export const SYSTEM_BOUNDARY: BoundaryRect = {
  x: 32,
  y: 40,
  width: 440,
  height: 300,
};

/**
 * Place nodes: units / flows / resources inside the boundary; externals outside.
 *
 * @param nodes - Visible nodes
 */
export function layoutNodes(nodes: readonly ArchitectureNode[]): ReadonlyMap<string, NodePosition> {
  const inside = nodes.filter((n) => n.insideBoundary);
  const outside = nodes.filter((n) => !n.insideBoundary);
  const map = new Map<string, NodePosition>();

  const cols = Math.max(1, Math.ceil(Math.sqrt(inside.length)));
  const cellW = SYSTEM_BOUNDARY.width / (cols + 1);
  const rows = Math.max(1, Math.ceil(inside.length / cols));
  const cellH = SYSTEM_BOUNDARY.height / (rows + 1);

  inside.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    map.set(n.id, {
      id: n.id,
      x: SYSTEM_BOUNDARY.x + cellW * (col + 1),
      y: SYSTEM_BOUNDARY.y + cellH * (row + 1),
    });
  });

  outside.forEach((n, i) => {
    map.set(n.id, {
      id: n.id,
      x: SYSTEM_BOUNDARY.x + SYSTEM_BOUNDARY.width + 96,
      y: SYSTEM_BOUNDARY.y + 48 + i * 56,
    });
  });

  return map;
}
