/**
 * SSE id carried on a live agent event without changing its JSON payload.
 *
 * The follow log stores a seq. The live `fx.run` frame for that row uses the
 * same seq as `id:` so a client can resume with `Last-Event-ID`.
 */

const sseIdBrand: unique symbol = Symbol.for("oke.sse.id");

/**
 * Copy `value` and attach an SSE id the encoder writes as `id:`.
 * The id is not enumerable, so it is not part of the JSON payload.
 *
 * @param value - Event object
 * @param id - SSE id (the stored log seq)
 */
export function withSseId<T extends object>(value: T, id: string): T {
  const copy: T = { ...value };
  Object.defineProperty(copy, sseIdBrand, { value: id, enumerable: false });
  return copy;
}

/**
 * SSE id attached by {@link withSseId}, if any.
 *
 * @param value - Stream chunk
 */
export function readSseId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const id = (value as { readonly [sseIdBrand]?: unknown })[sseIdBrand];
  return typeof id === "string" ? id : undefined;
}
