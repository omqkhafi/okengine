/**
 * Clock per-tenant row hooks — lazy chunk.
 *
 * A static import from `app.ts` would pin Clock reconcile on every `oke()`
 * graph, including Store-only apps that never enable `gate.auth.tenant`.
 */

export { orphanPerTenantCronRows, putPerTenantCronRows } from "../elements/clock/reconcile.ts";
