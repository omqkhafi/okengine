/**
 * Runtime validation of Manifest documents against `spec/manifest.v1.schema.json`.
 */

import Ajv2020, { type AnySchema, type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { Manifest } from "./types.ts";

/** A single schema violation. */
export interface ManifestValidationIssue {
  /** JSON Pointer path, when available. */
  path: string;
  message: string;
  keyword?: string;
}

/** Outcome of {@link validateManifest}. */
export type ManifestValidationResult =
  | { ok: true; manifest: Manifest }
  | { ok: false; issues: ManifestValidationIssue[] };

const SCHEMA_URL = new URL("../../spec/manifest.v1.schema.json", import.meta.url);

let validator: ReturnType<Ajv2020["compile"]> | undefined;
let schemaDocument: unknown;

/**
 * URL of the versioned public schema (readable without okengine runtime code).
 */
export function manifestSchemaUrl(): URL {
  return SCHEMA_URL;
}

/**
 * Load (and cache) the Manifest v1 JSON Schema document.
 */
export async function loadManifestSchema(): Promise<unknown> {
  if (schemaDocument !== undefined) return schemaDocument;
  const text = await Bun.file(SCHEMA_URL).text();
  schemaDocument = JSON.parse(text) as unknown;
  return schemaDocument;
}

function getValidator(schema: unknown): ReturnType<Ajv2020["compile"]> {
  if (validator) return validator;
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateSchema: true,
  });
  addFormats(ajv);
  validator = ajv.compile(schema as AnySchema);
  return validator;
}

function issueFromError(error: ErrorObject): ManifestValidationIssue {
  const path = error.instancePath === "" ? "/" : error.instancePath;
  const message = error.message ?? "validation failed";
  return {
    path,
    message: error.params ? `${message} (${JSON.stringify(error.params)})` : message,
    keyword: error.keyword,
  };
}

/**
 * Validate an unknown value as a Manifest v1 document.
 *
 * Pure with respect to the input — does not mutate `input`.
 */
export async function validateManifest(input: unknown): Promise<ManifestValidationResult> {
  const schema = await loadManifestSchema();
  const validate = getValidator(schema);
  const ok = validate(input);
  if (ok) {
    return { ok: true, manifest: input as Manifest };
  }
  const errors = validate.errors ?? [];
  return {
    ok: false,
    issues: errors.map(issueFromError),
  };
}

/**
 * Parse JSON text, validate, and return a typed Manifest.
 *
 * @throws {ManifestValidationError} when the document is invalid
 */
export async function parseManifest(text: string): Promise<Manifest> {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ManifestValidationError(
      [{ path: "/", message: `invalid JSON: ${String(cause)}` }],
      cause,
    );
  }
  const result = await validateManifest(value);
  if (!result.ok) {
    throw new ManifestValidationError(result.issues);
  }
  return result.manifest;
}

/**
 * Serialise a Manifest to stable, lossless JSON text (2-space indent + trailing newline).
 */
export function serializeManifest(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Round-trip: parse → serialise → parse, asserting structural equality.
 *
 * @returns the re-parsed Manifest when lossless
 * @throws {Error} when the round-trip is lossy
 */
export async function assertLosslessRoundTrip(text: string): Promise<Manifest> {
  const first = await parseManifest(text);
  const again = await parseManifest(serializeManifest(first));
  if (!stableEqual(first, again)) {
    throw new Error("manifest round-trip was lossy");
  }
  return again;
}

/**
 * Error raised when a document fails Manifest schema validation.
 */
export class ManifestValidationError extends Error {
  /** Structured validation issues. */
  readonly issues: ManifestValidationIssue[];

  /**
   * @param issues - schema violations
   * @param cause - optional parse cause
   */
  constructor(issues: ManifestValidationIssue[], cause?: unknown) {
    const summary = issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    super(`Invalid Manifest: ${summary}`, cause !== undefined ? { cause } : undefined);
    this.name = "ManifestValidationError";
    this.issues = issues;
  }
}

/** Deep equality after sorting object keys (order-insensitive objects, order-sensitive arrays). */
function stableEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeys(obj[key]);
    }
    return out;
  }
  return value;
}
