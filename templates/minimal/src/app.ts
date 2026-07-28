import { db } from "./core";

import { oke } from "okengine";
import * as main from "./flows/main";

export const app = oke({ name: "minimal" }).adopt({ main });

export type App = typeof app;

Object.assign(app.$options, {
  stores: [db],
});
