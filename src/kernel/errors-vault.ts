/**
 * OKE1510 — kept off the kernel edge graph.
 *
 * Vault boot gaps. Loaded via computed `import.meta.require` from
 * {@link lookupOkeError}.
 */

import type { OkeErrorDefinition } from "./errors.ts";

/** Vault contract has no value in any resolution layer (boot). */
export const VAULT_SECRET_MISSING: OkeErrorDefinition = {
  code: 1510,
  domain: "vault",
  cause: "{count} secrets have no value in any resolution layer.",
  fix: "Set each name (`oke vault set <name>`, or `.env.local`).",
};
