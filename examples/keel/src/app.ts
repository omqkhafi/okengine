import "@/core";

import { oke } from "okengine/http";
import * as routes from "@/flows/generated";

export const app = oke({
  name: "keel",
}).adopt(routes);

export type App = typeof app;
