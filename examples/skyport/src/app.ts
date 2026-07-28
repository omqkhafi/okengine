import { db } from "./core";
import { member, fair } from "./gates";
import { dbUrl, dbReplica1, anthropicKey, stripeKey } from "./vault";
import { bookingConfirmed } from "./channels";
import { orderPlaced, seatFeed } from "./flows/bookings/signals";
import { smart, fast, triage, embed, support as supportAgentDecl } from "./ai";
import { canBook } from "./flows/bookings";
import "./journeys";
import "./ai";
import "./channels";
import "./gates";

import { oke } from "okengine";
import { auth } from "okengine/auth";
import { audit } from "./plugins/audit";
import * as bookings from "./flows/bookings";
import * as payments from "./flows/payments";
import * as notifications from "./flows/notifications";
import * as support from "./flows/support";
import * as users from "./flows/users";

export const app = oke({ name: "skyport" })
  .adopt({ bookings, payments, notifications, support, users })
  .plug(auth())
  .plug(audit)
  .hook("onError", (ctx, err, fx) => fx.log.error(err));

export type App = typeof app;

Object.assign(app.$options, {
  env: "test",
  gates: [member, canBook, fair],
  secrets: [dbUrl, dbReplica1, anthropicKey, stripeKey],
  signals: [orderPlaced, seatFeed],
  stores: [db],
  channel: {
    templates: [bookingConfirmed],
    defaultLocale: "ar",
  },
  ai: {
    models: [smart, fast],
    prompts: [triage],
    embeds: [embed],
    agents: [supportAgentDecl],
  },
});
