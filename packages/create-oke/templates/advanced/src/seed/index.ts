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
      body: "Advanced Notes starter — attach files, summarize with AI, daily digest clock.",
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
      body: "Confirm schema with oke db push (or migrate in docker), then oke db seed.",
      archivedAt: null,
      createdAt: 2,
    },
  );
  await fx.store(db).upsert(
    notes,
    { id: "sample-attach" },
    {
      id: "sample-attach",
      title: "Try attach",
      body: "POST /notes/:id/attach stores a text blob on files:uploads.",
      archivedAt: null,
      createdAt: 3,
    },
  );
  await fx.store(db).upsert(
    notes,
    { id: "sample-summarize" },
    {
      id: "sample-summarize",
      title: "Try summarize",
      body: "POST /notes/:id/summarize uses fx.ask when AI is configured, else a local excerpt.",
      archivedAt: null,
      createdAt: 4,
    },
  );
}

export default defineSeed({
  essential: welcomeNote,
  dev: sampleNotes,
  // prod: async (fx) => { /* real production-only data, e.g. register a webhook */ },
});
