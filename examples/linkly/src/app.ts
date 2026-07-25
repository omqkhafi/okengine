import { db } from "./core";
import { member, fair } from "./gates";
import { linkClicked, linkStats } from "./flows/links/signals";

import { oke } from "okengine";
import * as links from "./flows/links";
import * as analytics from "./flows/analytics";

export const app = oke({ name: "linkly" }).adopt({ links, analytics });

export type App = typeof app;

// Spec test calls `t.api.links.report` though `report` lives in analytics.
app.adopt({ links: { report: analytics.report } });

Object.assign(app.$options, {
  env: "test",
  gates: [member, fair],
  signals: [linkClicked, linkStats],
  stores: [db],
});
