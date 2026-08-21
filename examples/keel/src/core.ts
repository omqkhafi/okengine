/**
 * App core — element wiring loaded by `import "@/core"` from `app.ts`.
 *
 * Order: locales → store → gate → vault → channel → clock → AI.
 */

import "@/locales";

export * from "./core/store.ts";
export * from "./core/gate.ts";
export * from "./core/vault.ts";
export * from "./core/channel.ts";
export * from "./core/clock.ts";
export * from "./core/ai.ts";
