/**
 * `oke stack` — preview resolved images / tags / ports (writes nothing).
 */

import { buildSpecs } from "./compose.ts";
import { recipeFor } from "./recipes/index.ts";
import { extraHostPortForInstance } from "./stack-id.ts";
import type { DeriveOptions, ServiceSpec } from "./types.ts";

/** Extra published host↔container mapping for stack preview. */
export interface StackExtraPort {
  readonly hostPort: number;
  readonly containerPort: number;
}

/** One resolved stack row for preview. */
export interface StackRow {
  readonly role: string;
  readonly image: string;
  readonly recipe: string;
  readonly service: string;
  readonly containerPort: number;
  readonly hostPort: number;
  /** Additional published ports (Mailpit UI, RustFS console, …). */
  readonly extraPorts: readonly StackExtraPort[];
}

/**
 * Resolve stack preview rows from image pins.
 *
 * @param options - Images (+ optional recipes / instanceId)
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
    const ports = [
      `${r.hostPort}:${r.containerPort}`,
      ...r.extraPorts.map((p) => `${p.hostPort}:${p.containerPort}`),
    ].join(", ");
    lines.push(`${pad(r.role, 14)}  ${pad(r.recipe, 9)}  ${pad(r.image, 33)}  ${ports}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Resolve additional published ports for a service (instance-aware).
 *
 * @param spec - Normalised service
 * @param options - Derive options
 */
export function resolveExtraPorts(
  spec: ServiceSpec,
  options: DeriveOptions,
): readonly StackExtraPort[] {
  const recipe = recipeFor(spec.image, options.recipes ?? []);
  const applied = recipe.apply(spec);
  return (applied.extraPorts ?? []).map((p) => ({
    containerPort: p.container,
    hostPort: options.instanceId
      ? extraHostPortForInstance(spec.role, p.host, options.instanceId)
      : p.host,
  }));
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
    extraPorts: resolveExtraPorts(spec, options),
  };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
