import { db } from "./core";
import { open } from "./gates";
import { appSecret } from "./vault";
import { welcome } from "./channels";
import { stub, echo } from "./ai";
import { pinged } from "./flows/main/signals";
import "./channels";
import "./gates";
import "./ai";
import "./locales/en";
import "./locales/ar";

import { oke } from "okengine";
import * as main from "./flows/main";

export const app = oke({ name: "full" }).adopt({ main });

export type App = typeof app;

Object.assign(app.$options, {
  env: "test",
  gates: [open],
  secrets: [appSecret],
  signals: [pinged],
  stores: [db],
  channel: {
    templates: [welcome],
    defaultLocale: "en",
  },
  ai: {
    models: [stub],
    prompts: [echo],
  },
});
