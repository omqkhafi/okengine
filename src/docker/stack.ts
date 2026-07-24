/**
 * `oke stack` — preview resolved images / tags / ports (writes nothing).
 */

import { buildSpecs } from "./compose.ts";
import { recipeFor } from "./recipes/index.ts";
import type { DeriveOptions, ServiceSpec } from "./types.ts";

/** One resolved stack row for preview. */
export interface StackRow {
  readonly role: string;
  readonly image: string;
  readonly recipe: string;
  readonly service: string;
  readonly containerPort: number;
  readonly hostPort: number;
}

/**
 * Resolve stack preview rows from image pins.
 *
 * @param options - Images (+ optional recipes)
 */
export function resolveStack(options: DeriveOptions): readonly StackRow[] {
  const specs = buildSpecs(options);
  return specs.map((s) => toRow(s, options));
}

/**
 * Format stack preview for the CLI.
 *
 * @param rows - Resolved rows
 */
export function formatStackPreview(rows: readonly StackRow[]): string {
  if (rows.length === 0) return "oke stack: no images configured\n";
  const lines = [
    "ROLE            RECIPE     IMAGE                              HOST:CONTAINER",
    "--------------  ---------  ---------------------------------  --------------",
  ];
  for (const r of rows) {
    lines.push(
      `${pad(r.role, 14)}  ${pad(r.recipe, 9)}  ${pad(r.image, 33)}  ${r.hostPort}:${r.containerPort}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function toRow(spec: ServiceSpec, options: DeriveOptions): StackRow {
  const recipe = recipeFor(spec.image, options.recipes ?? []);
  return {
    role: spec.role,
    image: spec.image,
    recipe: recipe.id,
    service: spec.serviceName,
    containerPort: spec.port,
    hostPort: spec.hostPort,
  };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
