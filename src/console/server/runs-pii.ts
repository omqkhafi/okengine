/**
 * Mask PII-classified fields on the shared Runs / Traces / Overview projection.
 *
 * Store masks by schema classification at the driver boundary. Wide events
 * carry the same field names as dimensions and `fx.log` data — without a
 * central mask here, a classified `email` that lands in a run dimension would
 * leak in every panel that reads `console.runs.list` (console §6 · §9.5 · §9.11).
 */

import { PII_MASK } from "../../elements/store/classify.ts";
import type { Manifest } from "../../manifest/types.ts";
import type { WideEvent } from "../../runs/types.ts";

/**
 * Collect PII field names from Manifest store classifications.
 *
 * Keys are bare column / field names (`email`), not `table.column`, so a
 * dimension or log key matching a classified column is masked regardless of
 * which store table it came from — same survival rule as Store's raw SQL path.
 *
 * @param manifest - Live Manifest snapshot
 */
export function piiFieldNamesFromManifest(
  manifest: Manifest | null | undefined,
): ReadonlySet<string> {
  const names = new Set<string>();
  if (!manifest?.stores) return names;
  for (const store of Object.values(manifest.stores)) {
    for (const table of Object.values(store.tables ?? {})) {
      for (const [col, tags] of Object.entries(table.columns ?? {})) {
        if (tags?.pii) names.add(col);
      }
    }
    for (const [key, tags] of Object.entries(store.classifications ?? {})) {
      if (
        tags &&
        typeof tags === "object" &&
        !Array.isArray(tags) &&
        "pii" in tags &&
        (tags as { pii?: boolean }).pii
      ) {
        const col = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
        names.add(col);
      }
    }
  }
  return names;
}

/**
 * Mask a record's values whose keys are PII-classified field names.
 *
 * @param record - Dimensions or log data
 * @param piiFields - Classified field names
 * @param mask - Mask token
 */
export function maskPiiRecord<T extends Record<string, unknown>>(
  record: T,
  piiFields: ReadonlySet<string>,
  mask: string = PII_MASK,
): T {
  if (piiFields.size === 0) return { ...record };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = piiFields.has(key) ? mask : value;
  }
  return out as T;
}

/**
 * Apply schema-classification PII masking to a wide event for Console projection.
 *
 * @param event - Stored wide event
 * @param piiFields - Classified field names from the Manifest
 */
export function maskWideEventForConsole(
  event: WideEvent,
  piiFields: ReadonlySet<string>,
): WideEvent {
  if (piiFields.size === 0) return event;
  const dimensions = maskPiiRecord(
    { ...event.dimensions } as Record<string, unknown>,
    piiFields,
  ) as WideEvent["dimensions"];
  const logs = event.logs.map((line) => {
    if (line.data === undefined) return line;
    return {
      ...line,
      data: maskPiiRecord(line.data as Record<string, unknown>, piiFields),
    };
  });
  const input =
    event.input !== undefined &&
    event.input !== null &&
    typeof event.input === "object" &&
    !Array.isArray(event.input)
      ? maskPiiRecord(event.input as Record<string, unknown>, piiFields)
      : event.input;
  return {
    ...event,
    dimensions,
    logs,
    ...(input !== undefined ? { input } : {}),
  };
}
