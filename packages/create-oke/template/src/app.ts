import { db } from "./core";
import "./gates";
import "./vault";
import "./channels";
import "./locales/en";
import "./locales/ar";

import { oke } from "okengine";
import * as main from "./flows/main";

export const app = oke({ name: "standard" }).adopt({ main });

export type App = typeof app;

Object.assign(app.$options, {
  env: "test",
  stores: [db],
});
