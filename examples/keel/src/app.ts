import "@/core";

import { oke } from "okengine/http";
import {
  KEEL_CLOCKS,
  KEEL_EXTRA_STORES,
  KEEL_GATES,
  KEEL_TEMPLATES,
  KEEL_VAULT,
} from "@/core";
import * as routes from "@/flows/generated";

export const app = oke({
  name: "keel",
  secrets: [...KEEL_VAULT],
  stores: [...KEEL_EXTRA_STORES],
  clocks: [...KEEL_CLOCKS],
  channel: { templates: [...KEEL_TEMPLATES] },
  gate: { policies: [...KEEL_GATES] },
}).adopt(routes);

export type App = typeof app;
