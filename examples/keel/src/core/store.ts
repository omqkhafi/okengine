/**
 * Keel store decls — SQL, KV, files, index.
 */

import { store } from "okengine";
import * as schema from "@/db/schema.decl";

/** Primary keel SQL. */
export const db = store.sql("db", { schema, description: "Primary keel SQL" });

/** Compose drafts — durable so `oke db seed` survives a Redis recreate. */
export const draftsKv = store.kv("drafts", {
  durable: true,
  description: "Compose drafts",
});

/** Saved view preferences — durable so seed is visible in Console Store. */
export const viewPrefsKv = store.kv("view-prefs", {
  durable: true,
  description: "Saved view preferences",
});

/** Due-date reminder snoozes — durable so seed is visible in Console Store. */
export const remindersKv = store.kv("reminders", {
  durable: true,
  description: "Due-date reminders",
});

/** Outbound webhook registrations — durable so seed is visible in Console Store. */
export const webhooksKv = store.kv("webhooks", {
  durable: true,
  description: "Outbound webhooks",
});

/** Workspace object store — one bucket, folders per job. */
export const keelFiles = store.files("keel", {
  description: "Keel workspace files",
});

/** Semantic / full-text task search. */
export const taskIndex = store.index("tasks", { description: "Task search" });

/** Document title / body search. */
export const documentIndex = store.index("documents", { description: "Document search" });

/** Comment thread search. */
export const commentIndex = store.index("comments", { description: "Comment search" });

/** Project name search. */
export const projectIndex = store.index("projects", { description: "Project search" });
