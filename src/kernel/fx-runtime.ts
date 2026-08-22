/**
 * Execute-time `fx` helpers — lazy chunk off Store-only `oke()` construction.
 *
 * `app.ts` / HTTP encode load this via computed require so `createFx` does
 * not sit on graphs that never run a Flow.
 */

export {
  createFxContext,
  freezePrincipal,
  isJsonResult,
  isJsonStreamResult,
  isSseFrame,
  resolveName,
} from "./fx.ts";
