/**
 * Durable runner — lazy chunk off Store-only `oke()` construction.
 *
 * `runDurable` statically imports `createFx`; keeping that edge off graphs
 * that never run a durable Flow.
 */

export { runDurable } from "../elements/clock/durable.ts";
