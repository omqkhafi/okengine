/**
 * `fx.json` carriers — brand and guards, with no `fx` / Store graph.
 *
 * `project-out` and the HTTP encoder need these on the cold-start path.
 * Importing them from `fx.ts` would evaluate the Store barrel (Zod, hybrid
 * search) before the server listens.
 */

/** Brand for {@link JsonResult} (kept internal — flows never construct it). */
export const jsonResultBrand: unique symbol = Symbol.for("oke.json");

/** Carrier from `fx.json` — status + body read by the response encoder. */
export interface JsonResult<T = unknown> {
  readonly [jsonResultBrand]: true;
  readonly status: number;
  readonly value?: T;
  readonly meta?: Record<string, unknown>;
  readonly kind?: undefined;
}

/** SSE carrier from `fx.json.stream` / `fx.live`. */
export interface JsonStreamResult {
  readonly [jsonResultBrand]: true;
  readonly kind: "stream";
  readonly status: 200;
  readonly chunks: AsyncIterable<unknown>;
  /** Awaited before the 200 SSE body; throws OKE1210 on a missing resume cursor. */
  ready?: () => Promise<void>;
  /** Set by the kernel to commit journal / Runs after the stream settles. */
  finalize?: () => Promise<void>;
}

/**
 * True when `value` is an `fx.json` envelope carrier.
 *
 * @param value - Unknown handler output
 */
export function isJsonResult(value: unknown): value is JsonResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as JsonResult)[jsonResultBrand] === true &&
    (value as JsonStreamResult).kind !== "stream"
  );
}

/**
 * True when `value` is an SSE stream carrier from `fx.json.stream`.
 *
 * @param value - Unknown handler output
 */
export function isJsonStreamResult(value: unknown): value is JsonStreamResult {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as JsonStreamResult)[jsonResultBrand] === true &&
    (value as JsonStreamResult).kind === "stream"
  );
}
