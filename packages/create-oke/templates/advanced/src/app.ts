import "@/core";
import "@/flows/generated";

import { oke } from "okengine/http";
import { cors, csrf, passkey } from "okengine/plugins";
import { NOTES_VAULT } from "@/vault";

const viteOrigins = ["http://127.0.0.1:5173", "http://localhost:5173"] as const;

/**
 * Notes app — cookie auth + CSRF + passkey demo (additive to Notes Flows).
 * `vault.config` is not auto-registered (only `vault.secret` is), so pass
 * {@link NOTES_VAULT} for configs + secrets to resolve together.
 */
export const app = oke({
  name: "notes",
  secrets: NOTES_VAULT,
  gate: {
    auth: {
      cookies: { enabled: true },
      emailAndPassword: { enabled: true },
    },
  },
})
  .plug(
    csrf({
      allowNoHeader: false,
      allowOrigins: [...viteOrigins],
    }),
  )
  .plug(
    cors({
      origin: [...viteOrigins],
      credentials: true,
    }),
  )
  .plug(
    passkey({
      origins: [...viteOrigins, "http://127.0.0.1:6530", "http://localhost:6530"],
    }),
  );

export type App = typeof app;
