/**
 * OKE1605 — kept off the kernel edge profile.
 *
 * Channel `fx.send` throws this when template `data` fails the template schema.
 * Loaded via computed `import.meta.require` from {@link lookupOkeError}; the
 * Channel runtime imports it directly (that graph is not in `budget-entry`).
 */

import type { OkeErrorDefinition } from "./errors.ts";

/** Send payload failed the channel template's declared Standard Schema. */
export const CHANNEL_SCHEMA: OkeErrorDefinition = {
  code: 1605,
  domain: "channel",
  cause: '"{resource}": {detail}',
  fix: "Fix template data payload or the template schema.",
};
