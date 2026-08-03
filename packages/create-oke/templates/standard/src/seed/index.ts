import { defineSeed, type Fx } from "okengine";
import { db } from "../core";
import { notes } from "../schema.decl";

/**
 * Seed data — run explicitly with `oke db seed` (never at boot).
 *
 * Categories: `essential` (every env) · `dev` (local|docker) · `prod` (prod only).
 * For multi-file composition (`src/seed/essential/*.ts` + arrays here), see
 * Store docs → Seeding.
 */

async function welcomeNote(fx: Fx) {
  await fx.store(db).upsert(
    notes,
    { id: "welcome" },
    {
      id: "welcome",
      title: "Welcome",
      body: "Your Notes API is ready. Create, list, and archive notes over HTTP.",
      archivedAt: null,
      createdAt: 1,
    },
  );
}

async function sampleNotes(fx: Fx) {
  await fx.store(db).upsert(
    notes,
    { id: "sample-shipping" },
    {
      id: "sample-shipping",
      title: "Shipping checklist",
      body: "Confirm schema with oke db push, then seed with oke db seed.",
      archivedAt: null,
      createdAt: 2,
    },
  );
  await fx.store(db).upsert(
    notes,
    { id: "sample-ideas" },
    {
      id: "sample-ideas",
      title: "Ideas",
      body: "Replace these seed rows with your own domain data.",
      archivedAt: null,
      createdAt: 3,
    },
  );
}

export default defineSeed({
  essential: welcomeNote,
  dev: sampleNotes,
  // prod: async (fx) => { /* real production-only data, e.g. register a webhook */ },
});
