/**
 * Build {@link ClientDescriptor} for `GET /_oke/client.json` / `oke client add`.
 *
 * @module
 */

import type { ClientDescriptor } from "../client/types.ts";
import type { AnyFlowDef } from "./flow.ts";
import type { RuntimeRouteMap } from "./adopt-routes.ts";
import { z } from "zod";

/**
 * Build a client descriptor from runtime routes + flow defs (type strings + stamps).
 *
 * @param routes - Runtime `$routes` map
 * @param flowsByName - Flow name → definition (for schemas)
 */
export function buildClientDescriptor(
  routes: RuntimeRouteMap,
  flowsByName: ReadonlyMap<string, AnyFlowDef> | Readonly<Record<string, AnyFlowDef>>,
): ClientDescriptor {
  const lookup =
    flowsByName instanceof Map
      ? flowsByName
      : new Map(Object.entries(flowsByName as Record<string, AnyFlowDef>));

  type RouteEntry = ClientDescriptor["routes"][string][string];
  const out: Record<string, Record<string, RouteEntry>> = {};
  for (const [unit, flows] of Object.entries(routes)) {
    const unitOut: Record<string, RouteEntry> = {};
    for (const [flowName, stamp] of Object.entries(flows)) {
      const full = `${unit}.${flowName}`;
      const def = lookup.get(full) ?? lookup.get(flowName);
      const errors: Record<string, string> = {};
      if (def?.errors) {
        for (const [code, schema] of Object.entries(def.errors)) {
          errors[code] = schemaToTsString(schema);
        }
      }
      unitOut[flowName] = {
        in: schemaToTsString(def?.in),
        out: schemaToTsString(def?.out),
        ...(Object.keys(errors).length > 0 ? { errors } : { errors: {} }),
        ...(stamp.method !== undefined ? { method: stamp.method } : {}),
        ...(stamp.path !== undefined ? { path: stamp.path } : {}),
        ...(stamp.live !== undefined ? { live: stamp.live } : {}),
        ...(stamp.stream === true ? { stream: true as const } : {}),
        ...(stamp.matchKey !== undefined ? { matchKey: stamp.matchKey } : {}),
        ...(stamp.gates !== undefined && stamp.gates.length > 0 ? { gates: stamp.gates } : {}),
      };
    }
    out[unit] = unitOut;
  }
  return { routes: out };
}

/**
 * Print a compact TypeScript type string from a schema (Zod / JSON Schema).
 * Falls back to `unknown` when unprintable.
 *
 * @param schema - Flow in/out/error schema
 */
export function schemaToTsString(schema: unknown): string {
  if (schema === undefined || schema === null) return "unknown";
  try {
    if (hasToJSONSchema(schema)) {
      return jsonSchemaToTs(schema.toJSONSchema());
    }
    // Zod 4 schemas expose `~standard` — convert via z.toJSONSchema when possible.
    const json = z.toJSONSchema(schema as never);
    return jsonSchemaToTs(json);
  } catch {
    if (isObjectSchema(schema)) return jsonSchemaToTs(schema);
    return "unknown";
  }
}

function hasToJSONSchema(value: unknown): value is { toJSONSchema: () => unknown } {
  return (
    value !== null &&
    typeof value === "object" &&
    "toJSONSchema" in value &&
    typeof (value as { toJSONSchema?: unknown }).toJSONSchema === "function"
  );
}

function isObjectSchema(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && "type" in value;
}

function jsonSchemaToTs(schema: unknown): string {
  if (schema === null || typeof schema !== "object") return "unknown";
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.anyOf) || Array.isArray(s.oneOf)) {
    const parts = ((s.anyOf ?? s.oneOf) as unknown[]).map(jsonSchemaToTs);
    return parts.join(" | ") || "unknown";
  }
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (Array.isArray(s.enum)) {
    return s.enum.map((v) => JSON.stringify(v)).join(" | ") || "unknown";
  }
  const typ = s.type;
  if (typ === "string") return "string";
  if (typ === "number" || typ === "integer") return "number";
  if (typ === "boolean") return "boolean";
  if (typ === "null") return "null";
  if (typ === "array") {
    const items = s.items !== undefined ? jsonSchemaToTs(s.items) : "unknown";
    return `readonly ${items}[]`;
  }
  if (typ === "object" || s.properties) {
    const props = (s.properties ?? {}) as Record<string, unknown>;
    const required = new Set(
      Array.isArray(s.required) ? s.required.filter((k): k is string => typeof k === "string") : [],
    );
    const lines = Object.entries(props).map(([k, v]) => {
      const opt = required.has(k) ? "" : "?";
      return `${JSON.stringify(k)}${opt}: ${jsonSchemaToTs(v)}`;
    });
    return `{ ${lines.join("; ")} }`;
  }
  return "unknown";
}
