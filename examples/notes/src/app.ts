import { db } from "./core";

import { oke } from "okengine";
import * as notes from "./flows/notes";

export const app = oke({ name: "notes" }).adopt({ notes });

export type App = typeof app;   // ← the client needs nothing else

Object.assign(app.$options, {
  env: "test",
  stores: [db],
});
