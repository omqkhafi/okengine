import { defineSeed, type Fx } from "okengine";
import { db } from "@/core";
import { notes } from "@/db/schema.decl";

/**
 * Seed data — run explicitly with `oke db seed` (never at boot).
 *
 * Categories: `essential` (every env) · `dev` (local|docker) · `prod` (prod only).
 * For multi-file composition (`src/db/seed/essential/*.ts` + arrays here), see
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
      createdAt: new Date("2026-01-15T10:00:00.000Z"),
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
      createdAt: new Date("2026-01-15T10:01:00.000Z"),
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
      createdAt: new Date("2026-01-15T10:02:00.000Z"),
    },
  );
  await fx.store(db).upsert(
    notes,
    { id: "sample-summarize" },
    {
      id: "sample-summarize",
      title: "Try summarize",
      body: "POST /notes/:id/summarize uses fx.ask with the prompt's via recovery chain.",
      archivedAt: null,
      createdAt: new Date("2026-01-15T10:03:00.000Z"),
    },
  );
}

export default defineSeed({
  name: "notes",
  description: "Welcome + sample notes",
  essential: welcomeNote,
  dev: sampleNotes,
  // prod: async (fx) => { /* real production-only data, e.g. register a webhook */ },
});
