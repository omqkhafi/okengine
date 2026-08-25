import "@/core";

import { oke } from "okengine/http";
import { KEEL_VAULT } from "@/core";
import * as routes from "@/flows/generated";

export const app = oke({
  name: "keel",
  // `vault.config` contracts are not auto-registered (only `vault.secret`
  // is), so pass the full contract list explicitly for `fx.vault.get` to
  // resolve configs like KEEL_WORKSPACE in test / dev boots.
  secrets: KEEL_VAULT,
}).adopt(routes);

export type App = typeof app;
