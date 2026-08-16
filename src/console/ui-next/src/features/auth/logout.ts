/**
 * Operator logout — POST /console/session/logout, then drop the local token.
 */

import { sessionLogout, setAccessToken } from "../../client.ts";

/**
 * End the operator session. Always clears the local token, even when the
 * server call fails (expired cookie, offline).
 */
export async function logoutOperator(): Promise<void> {
  try {
    await sessionLogout();
  } finally {
    setAccessToken(null);
  }
}
