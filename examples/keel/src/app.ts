import "@/core";

import { oke } from "okengine/http";
import { KEEL_VAULT } from "@/core";
import * as routes from "@/flows";

export const app = oke({
  name: "keel",
  // `vault.config` contracts are not auto-registered (only `vault.secret`
  // is), so pass the full contract list explicitly for `fx.vault.get` to
  // resolve configs like KEEL_WORKSPACE in test / dev boots.
  secrets: KEEL_VAULT,
  // Bearer API keys (Console Access) need a verifier. `http: false` keeps
  // `/auth/*` off; policies stay on the Flows.
  gate: { auth: { http: false } },
}).adopt(routes);

export type App = typeof app;
