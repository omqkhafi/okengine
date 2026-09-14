import "@/core";
import "@/flows";

import { oke } from "okengine/http";
import { APP_VAULT } from "@/core/vault";

/**
 * Shorter — `vault.config` is not auto-registered (only `vault.secret` is),
 * so pass {@link APP_VAULT} for configs + secrets to resolve together.
 *
 * Channel bodies live on `mail.template({ catalog })` in `src/core/email.ts`.
 */
export const app = oke({
  name: "shorter",
  secrets: APP_VAULT,
  gate: {
    auth: {
      emailAndPassword: { enabled: true },
    },
  },
});

/** Typed Shorter app — `createTestApp` and the typed client. */
export type App = typeof app;
