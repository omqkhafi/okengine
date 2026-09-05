import "@/core";
import "@/flows/generated";

import { oke } from "okengine/http";
import { NOTES_VAULT } from "@/vault";

/**
 * Notes app — `vault.config` is not auto-registered (only `vault.secret` is),
 * so pass {@link NOTES_VAULT} for configs + secrets to resolve together.
 */
export const app = oke({ name: "notes", secrets: NOTES_VAULT });

export type App = typeof app;
