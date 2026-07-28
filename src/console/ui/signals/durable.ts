/**
 * The single most important line in the Signals panel (console §9.4).
 *
 * Read from Manifest `flow.durable` on consumers — never guess.
 */

/** Durability statement shown at the point of replay decision. */
export interface DurableLine {
  /** Whether consumers are durable (`null` = no consumers). */
  readonly durable: boolean | null;
  /** Plain-language statement for the operator. */
  readonly statement: string;
}

/**
 * Build the durability statement for a signal's consumers.
 *
 * @param consumersDurable - From Manifest (`flow.durable` on every consumer)
 */
export function durableLine(consumersDurable: boolean | null): DurableLine {
  if (consumersDurable === true) {
    return {
      durable: true,
      statement:
        "Consumer is durable — replay resumes at the failed journal step and side effects will not repeat.",
    };
  }
  if (consumersDurable === false) {
    return {
      durable: false,
      statement:
        "Consumer is not durable — everything re-runs from the start, including side effects. Declare durable: true on the consumer so replay resumes at the failed journal step.",
    };
  }
  return {
    durable: null,
    statement: "No consumer declared — replay has no target flow.",
  };
}
