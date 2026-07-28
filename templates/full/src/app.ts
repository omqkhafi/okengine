import { db } from "./core";
import { burst, cheap, exact, fair } from "./gates";
import { appSecret } from "./vault";
import { pingNotice } from "./channels";
import { mock, echo } from "./ai";
import { pinged } from "./flows/main/signals";
import "./locales/en";
import "./locales/ar";

import { oke } from "okengine";
import * as main from "./flows/main";

export const app = oke({ name: "full" }).adopt({ main });

export type App = typeof app;

Object.assign(app.$options, {
  gates: [fair, cheap, exact, burst],

  secrets: [appSecret],
  signals: [pinged],
  stores: [db],
  channel: {
    templates: [pingNotice],
    defaultLocale: "en",
  },
  ai: {
    models: [mock],
    prompts: [echo],
  },
});
