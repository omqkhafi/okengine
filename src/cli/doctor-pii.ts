/**
 * Project-wide PII → third-party model check for `oke doctor`.
 *
 * Reuses {@link assertAllowPiiForAsk} — does not reimplement matching.
 */

import {
  AiPiiBuildError,
  assertAllowPiiForAsk,
} from "../elements/ai/pii.ts";
import type {
  AiPrompt,
  ClassificationValue,
  Flow,
  JsonSchema,
  Manifest,
} from "../manifest/types.ts";
import type { DoctorFinding } from "./doctor.ts";

/**
 * Walk the whole Manifest and fail every flow that would send a
 * pii-classified field to `fx.ask` without `allowPii`.
 *
 * @param manifest - Extracted Manifest
 */
export function checkManifestPiiAsks(
  manifest: Manifest,
): readonly DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const classifications = collectClassifications(manifest);
  const flows = manifest.flows ?? {};
  const prompts = manifest.ai?.prompts ?? {};
  const models = manifest.ai?.models ?? {};

  for (const [flowId, flow] of Object.entries(flows)) {
    const asks = flow.effects?.asks ?? [];
    if (asks.length === 0) continue;

    const askFields = askFieldsForFlow(flow, asks, prompts);
    if (askFields.length === 0) continue;

    const provider = providerForAsks(asks, prompts, models);

    try {
      assertAllowPiiForAsk({
        flow: flowId,
        askFields,
        classifications,
        provider,
        allowPii: flow.allowPii,
        pii: flow.pii,
      });
    } catch (err) {
      if (err instanceof AiPiiBuildError) {
        findings.push({
          code: "pii_ask",
          severity: "error",
          message: err.message,
        });
      } else {
        throw err;
      }
    }
  }

  return findings;
}

/**
 * Flatten store / table classifications into the map assertAllowPiiForAsk uses.
 *
 * @param manifest - Manifest
 */
export function collectClassifications(
  manifest: Manifest,
): Readonly<Record<string, ClassificationValue>> {
  const out: Record<string, ClassificationValue> = {};
  for (const store of Object.values(manifest.stores ?? {})) {
    for (const [key, tags] of Object.entries(store.classifications ?? {})) {
      out[key] = tags;
    }
    for (const [tableName, table] of Object.entries(store.tables ?? {})) {
      for (const [col, tags] of Object.entries(table.columns ?? {})) {
        out[`${tableName}.${col}`] = tags;
        out[col] = tags;
      }
      for (const [col, tags] of Object.entries(table.classifications ?? {})) {
        out[`${tableName}.${col}`] = tags;
        out[col] = tags;
      }
    }
  }
  return out;
}

/**
 * Field names a flow may pass into `fx.ask` — from flow / prompt `in` schemas.
 *
 * @param flow - Flow
 * @param asks - Prompt refs
 * @param prompts - Manifest prompts
 */
export function askFieldsForFlow(
  flow: Flow,
  asks: readonly string[],
  prompts: Readonly<Record<string, AiPrompt>>,
): string[] {
  const fields = new Set<string>();
  for (const name of schemaPropertyNames(flow.in)) fields.add(name);
  for (const ref of asks) {
    const promptName = ref.split("@")[0]!;
    const prompt = prompts[promptName];
    if (!prompt) continue;
    for (const name of schemaPropertyNames(prompt.in)) fields.add(name);
  }
  return [...fields].sort();
}

/**
 * Resolve the model provider used by asked prompts (third-party check).
 *
 * @param asks - Prompt refs
 * @param prompts - Manifest prompts
 * @param models - Manifest models
 */
export function providerForAsks(
  asks: readonly string[],
  prompts: Readonly<Record<string, AiPrompt>>,
  models: Readonly<Record<string, { readonly provider?: string }>>,
): string | undefined {
  for (const ref of asks) {
    const promptName = ref.split("@")[0]!;
    const prompt = prompts[promptName];
    const modelName = prompt?.model;
    if (modelName && models[modelName]?.provider) {
      return models[modelName]!.provider;
    }
  }
  // Prompt has no explicit model — any declared provider stands in.
  for (const m of Object.values(models)) {
    if (m.provider) return m.provider;
  }
  return undefined;
}

function schemaPropertyNames(schema: JsonSchema | undefined): string[] {
  if (!schema || typeof schema === "string") return [];
  const props = schema.properties;
  if (!props || typeof props !== "object" || Array.isArray(props)) return [];
  return Object.keys(props as Record<string, unknown>);
}
