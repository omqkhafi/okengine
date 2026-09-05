import "@/core";
import "@/flows/generated";

import { oke } from "okengine/http";
import { cors, csrf, passkey } from "okengine/plugins";

const viteOrigins = ["http://127.0.0.1:5173", "http://localhost:5173"] as const;

/**
 * Notes app — cookie auth + CSRF + passkey demo (additive to Notes Flows).
 */
export const app = oke({
  name: "notes",
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
