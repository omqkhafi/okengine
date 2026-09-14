/**
 * App core — element wiring loaded by `import "@/core"` from `app.ts`.
 *
 * Order matches how you usually extend the starter:
 * locales → store → gate → vault → channel → AI (`oke ai setup` fills `ai.ts`).
 */

import "@/locales";

export * from "./store.ts";
export * from "./gate.ts";
export * from "./vault.ts";
export * from "./email.ts";
export * from "./ai.ts";
