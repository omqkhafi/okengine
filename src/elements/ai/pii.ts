/**
 * Compile-time AI data governance — PII cannot reach a third-party model
 * without an explicit `allowPii` acknowledgement.
 */

import type { ColumnClassification } from "../../manifest/types.ts";

/** Input to {@link assertAllowPiiForAsk}. */
export interface PiiAskCheckInput {
  /** Flow id under analysis. */
  readonly flow: string;
  /**
   * Flow-level PII policy. `"allow"` or `allowPii: true` permits egress.
   * `"masked"` / `"denied"` / omitted → build fails when PII fields are sent.
   */
  readonly pii?: "masked" | "allow" | "denied";
  /** Explicit allow flag (alias of `pii: "allow"`). */
  readonly allowPii?: boolean;
  /** Field names passed into `fx.ask` (from effect inference / AST). */
  readonly askFields: readonly string[];
  /**
   * Classification map: `table.column` or bare field → tags.
   * Bare field names match when any classified column shares the name.
   */
  readonly classifications: Readonly<
    Record<string, ColumnClassification | string | readonly string[]>
  >;
  /** Model provider — `mock` / local providers are not third-party. */
  readonly provider?: string;
}

/**
 * Error thrown when a flow would send PII to a third-party model.
 */
export class AiPiiBuildError extends Error {
  readonly flow: string;
  readonly fields: readonly string[];

  /**
   * @param flow - Flow id
   * @param fields - PII field names
   */
  constructor(flow: string, fields: readonly string[]) {
    super(
      `build failed: flow "${flow}" sends pii field(s) [${fields.join(", ")}] to a third-party model without allowPii`,
    );
    this.name = "AiPiiBuildError";
    this.flow = flow;
    this.fields = fields;
  }
}

/**
 * Whether a classification entry marks PII.
 *
 * @param tags - Classification value
 */
function isPiiTags(tags: ColumnClassification | string | readonly string[] | undefined): boolean {
  if (!tags) return false;
  if (typeof tags === "string") return tags === "pii";
  if (Array.isArray(tags)) return tags.includes("pii");
  return !!(tags as ColumnClassification).pii;
}

/**
 * Local / mock providers are not third-party egress.
 *
 * @param provider - Provider id
 */
function isThirdParty(provider: string | undefined): boolean {
  if (!provider) return true;
  const p = provider.toLowerCase();
  return p !== "mock" && p !== "local" && p !== "openai-compatible";
}

/**
 * Assert that a flow asking a model does not egress PII fields unless allowed.
 * Call from the compiler / `oke doctor` — failure fails the build.
 *
 * @param input - Flow + fields + classifications
 */
export function assertAllowPiiForAsk(input: PiiAskCheckInput): void {
  if (input.allowPii === true || input.pii === "allow") return;
  if (!isThirdParty(input.provider)) return;

  const piiFields: string[] = [];
  for (const field of input.askFields) {
    const direct = input.classifications[field];
    if (isPiiTags(direct)) {
      piiFields.push(field);
      continue;
    }
    for (const [key, tags] of Object.entries(input.classifications)) {
      if (!isPiiTags(tags)) continue;
      const col = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;
      if (col === field || key === field) {
        piiFields.push(field);
        break;
      }
    }
  }

  if (piiFields.length > 0) {
    throw new AiPiiBuildError(input.flow, piiFields);
  }
}
