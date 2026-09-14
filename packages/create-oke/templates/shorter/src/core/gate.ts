/**
 * Shorter gates — permission to act.
 *
 * Attach on the trigger (`.gate(...)`). Identity comes from `gate.auth`
 * in `app.ts`. Row ownership stays in Flow `do`.
 */

import { gate } from "okengine";

// --- Policy ------------------------------------------------------------------

/** Signed-in user (`gate.auth` + email/password). */
export const member = gate.policy("member", {
  description: "Signed-in user",
  check: ({ auth }) => !!auth.verified,
});

// --- Rate --------------------------------------------------------------------

/** Write throttle for create / archive. */
export const linksWriteRate = gate.rate({
  max: 60,
  per: "1m",
  keyBy: "user",
  description: "Link write throttle",
});

/** Public 302 throttle (anonymous, keyed by IP). */
export const linksRedirectRate = gate.rate({
  max: 300,
  per: "1m",
  keyBy: "ip",
  description: "Public redirect throttle",
});

// --- Compose -----------------------------------------------------------------

/** Member + write rate — create / archive. */
export const linksMutate = gate.all(member, linksWriteRate);

/** Public + IP rate — `GET /:code`. */
export const linksRedirect = gate.all(gate.public, linksRedirectRate);
