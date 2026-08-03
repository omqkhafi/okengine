/**
 * Durable-sleep park signal — shared by journal replay and `fx.retry`.
 *
 * Kept out of {@link ./journal.ts} so the edge profile (retry filter) does
 * not pull Node fs/path journal persistence into the browser bundle.
 */

/**
 * Thrown inside a durable body when a sleep has not yet elapsed.
 * The runner catches this and parks the run as `sleeping`.
 */
export class JournalSuspend extends Error {
  readonly wakeAt: number;
  readonly label: string;

  /**
   * @param label - Sleep label
   * @param wakeAt - Absolute wake epoch-ms
   */
  constructor(label: string, wakeAt: number) {
    super(`journal suspend: sleep "${label}" until ${wakeAt}`);
    this.name = "JournalSuspend";
    this.label = label;
    this.wakeAt = wakeAt;
  }
}

/**
 * True when `err` is a {@link JournalSuspend}.
 *
 * @param err - Unknown
 */
export function isJournalSuspend(err: unknown): err is JournalSuspend {
  return err instanceof JournalSuspend;
}
