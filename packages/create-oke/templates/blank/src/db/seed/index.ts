import { defineSeed } from "okengine";

/**
 * Seed data — run explicitly with `oke db seed` (never at boot).
 *
 * Categories: `essential` (every env) · `dev` (local|docker) · `prod` (prod only).
 * Add handlers when you introduce domain tables.
 */

export default defineSeed({
  name: "app",
  description: "No seed rows yet — add essential / dev / prod handlers",
});
