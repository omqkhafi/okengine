/**
 * App core — element wiring loaded by `import "@/core"` from `app.ts`.
 *
 * Order matches how you usually extend the starter:
 * locales → store → gate → vault → channel → (AI via `oke ai setup`).
 * Keep this file until a section outgrows it, then split by element.
 */

import "@/locales";

import { channel, gate, store, vault } from "okengine";
import { z } from "zod";
import * as schema from "@/db/schema.decl";

// --- Store -------------------------------------------------------------------

/** SQL store for Notes (`schema.decl`). Drivers: pglite locally · postgres in docker. */
export const db = store.sql("app", { schema });

// --- Gate --------------------------------------------------------------------

/**
 * Write policy for notes. Starter allows everyone — swap in real auth scopes:
 *
 * ```ts
 * export const notesWrite = gate.policy("notes:write", ({ auth }) =>
 *   auth.scopes.has("notes:write"),
 * );
 * export const notesMutate = gate.all(notesWrite, notesWriteRate);
 * ```
 */
export const notesWrite = gate.policy("notes:write", () => true);

/** Note write throttle. */
export const notesWriteRate = gate.rate({
  max: 60,
  per: "1m",
  keyBy: "ip",
  description: "Note write throttle",
});

/** Reuse on every notes mutate route. */
export const notesMutate = gate.all(notesWrite, notesWriteRate);

// --- Vault -------------------------------------------------------------------

/** HMAC secret for outbound note webhooks (`fx.vault.get` on create). */
export const webhookSecret = vault.secret("APP_WEBHOOK_SECRET", {
  description: "HMAC secret for outbound note webhooks",
  dev: "dev-webhook-secret-change-me",
});

// --- Channel -----------------------------------------------------------------

const mail = channel.email({ from: "Notes <notes@localhost>" });

/** Fired when a note is created (console driver locally · SMTP in docker). */
export const noteCreatedMail = mail.template("note-created", {
  locales: ["en"],
  schema: z.object({
    id: z.string(),
    title: z.string(),
  }),
});

// --- AI ----------------------------------------------------------------------
// Appended by `oke ai setup` / `create-oke --ai`.
// When an embed model is chosen, setup also wires Notes hybrid search:
//   oke({ store: { search: { embed: { model: embedModel, dims: 768 } } } })
//   body: field.text().searchable().embed()
// Registry cloud: provider "openrouter" + OPENROUTER_API_KEY (no baseUrl).
// Local self-host still needs an explicit baseUrl (or OKE_AI_URL on the binding).
