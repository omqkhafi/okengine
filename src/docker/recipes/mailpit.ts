/**
 * Mailpit image recipe — local SMTP catcher for docker ≈ prod email.
 */

import type { ImageRecipe } from "../types.ts";

/** SMTP catcher (Mailpit) — UI on 8025. */
export const mailpit: ImageRecipe = {
  id: "mailpit",
  port: 1025,
  match: (i) => /mailpit/i.test(i),
  apply: () => ({
    extraPorts: [{ host: 8025, container: 8025 }],
    healthcheck: {
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:8025/api/v1/info || exit 1"],
      interval: "5s",
      timeout: "3s",
      retries: 10,
    },
  }),
  url: (_s, c) => `smtp://${c.host}:${c.port}`,
};
