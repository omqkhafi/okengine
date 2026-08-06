import { db, files } from "./core";
import "./gates";
import "./vault";
import "./channels";
import "./locales/en";
import "./locales/ar";

import { oke } from "okengine";
import * as main from "./flows/main";
import * as notes from "./flows/notes";
import { noteCreated } from "./flows/notes/signals";
import { noteCreatedMail } from "./channels";
import { webhookSecret } from "./vault";

export const app = oke({
  name: "notes",
  stores: [db, files],
  secrets: [webhookSecret],
  signals: [noteCreated],
  channel: { templates: [noteCreatedMail] },
}).adopt({ main, notes });

export type App = typeof app;
