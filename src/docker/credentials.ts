/**
 * Credential generation for stack env — never written into compose YAML.
 */

import type { ServiceCredentials } from "./types.ts";

/**
 * Generate random credentials for a role.
 *
 * @param role - Role key (selects database name defaults)
 */
export function generateCredentials(role: string): ServiceCredentials {
  const password = randomToken(24);
  const database = role === "store.sql" ? "oke" : "oke";
  return { user: "oke", password, database };
}

/**
 * @param bytes - Entropy size
 */
function randomToken(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
