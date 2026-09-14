import { defineSeed, type Fx } from "okengine";
import { db } from "@/core";
import { links } from "@/db/schema";

/**
 * Seed data — run explicitly with `oke db seed` (never at boot).
 *
 * Categories: `essential` (every env) · `dev` (local|docker) · `prod` (prod only).
 */

/**
 * Welcome link (`oke` → docs site). Runs in every environment.
 *
 * @param fx - Seed effect context
 */
async function welcomeLink(fx: Fx) {
  await fx.store(db).upsert(
    links,
    { id: "welcome" },
    {
      id: "welcome",
      userId: "seed",
      code: "oke",
      url: "https://oke.omqkhafi.dev",
      clicks: 0,
      expiresAt: null,
      archivedAt: null,
      createdAt: "2026-01-15T10:00:00.000Z",
    },
  );
}

/**
 * Extra sample (`docs`). Local / docker only.
 *
 * @param fx - Seed effect context
 */
async function sampleLinks(fx: Fx) {
  await fx.store(db).upsert(
    links,
    { id: "sample-docs" },
    {
      id: "sample-docs",
      userId: "seed",
      code: "docs",
      url: "https://oke.omqkhafi.dev/docs",
      clicks: 0,
      expiresAt: null,
      archivedAt: null,
      createdAt: "2026-01-15T10:01:00.000Z",
    },
  );
}

/** Shorter seed — welcome + sample short links. */
export default defineSeed({
  name: "shorter",
  description: "Welcome + sample short links",
  essential: welcomeLink,
  dev: sampleLinks,
});
