import { oke } from "okengine";
import { db } from "./core";
import { member, fair } from "./gates";
import { linkClicked, linkStats } from "./flows/links/signals";
import { shorten, redirect, stats } from "./flows/links";
import { report } from "./flows/analytics";
import "./flows/links";
import "./flows/analytics";

export const app = oke({
  name: "linkly",
  gates: [member, fair],
  signals: [linkClicked, linkStats],
  stores: [db],
  env: "test",
}).adopt({
  links: { shorten, redirect, stats, report },
});

export type App = typeof app;
