/**
 * `Redacted<T>` — a plain value wrapper that keeps a secret value out of
 * logs, traces, and accidental serialization.
 *
 * Not an effect type: effect tracking only records which secret *names* a
 * flow touches. This is value hygiene inside a flow body.
 */

/** Placeholder used for any representation of a {@link Redacted}. */
export const REDACTED_PLACEHOLDER = "[redacted]";

/**
 * Wrap a value so printing / logging / JSON serialization never yields the
 * real value. The only way to read the wrapped value is {@link reveal}.
 */
export class Redacted<T> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  /**
   * Construct a {@link Redacted} without calling `new`.
   *
   * @param value - Wrapped secret
   */
  static of<T>(value: T): Redacted<T> {
    return new Redacted(value);
  }

  /** The one explicit way to get the real value. */
  reveal(): T {
    return this.#value;
  }

  /**
   * Transform the wrapped value without exposing it to callers.
   *
   * @param fn - Mapper over the cleartext
   */
  map<U>(fn: (value: T) => U): Redacted<U> {
    return Redacted.of(fn(this.#value));
  }

  toString(): string {
    return REDACTED_PLACEHOLDER;
  }

  toJSON(): string {
    return REDACTED_PLACEHOLDER;
  }

  valueOf(): string {
    return REDACTED_PLACEHOLDER;
  }

  [Symbol.toPrimitive](): string {
    return REDACTED_PLACEHOLDER;
  }

  /** `util.inspect` / `console.log` / Bun — never the real value. */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `Redacted<${typeof this.#value}>`;
  }
}

/** Type guard for {@link Redacted}. */
export function isRedacted(value: unknown): value is Redacted<unknown> {
  return value instanceof Redacted;
}

/**
 * Deep-walk a log/trace payload: replace every {@link Redacted} with the
 * placeholder (never the wrapped value); leave everything else untouched.
 *
 * @param value - Arbitrary structured data
 */
export function maskRedactedDeep<T>(value: T): T {
  return maskRedactedValue(value) as T;
}

function maskRedactedValue(value: unknown): unknown {
  if (isRedacted(value)) return REDACTED_PLACEHOLDER;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(maskRedactedValue);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = maskRedactedValue(v);
    }
    return out;
  }
  return value;
}
