import "@/core";
import "@/flows";

import { oke } from "okengine/http";
import { APP_VAULT } from "@/vault";

/**
 * Blank app — `vault.config` is not auto-registered (only `vault.secret` is),
 * so pass {@link APP_VAULT} for configs + secrets to resolve together.
 */
export const app = oke({ name: "app", secrets: APP_VAULT });

/** Typed app — `createTestApp` and the typed client. */
export type App = typeof app;
