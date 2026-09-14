import { on, flow, http } from "okengine/http";

import { RootOut } from "./shapes";

/**
 * First-run welcome (`GET /`).
 *
 * Visit :6530/ after `oke dev` — browser gets a code block; curl stays JSON.
 */
export const root = on(
  http.get({ out: RootOut }).public(),
  flow({
    do: () => ({
      ok: true as const,
      app: "shorter",
      try: ["POST /links", "GET /:code", "GET /health"],
      console: "http://127.0.0.1:6533",
    }),
  }),
);
