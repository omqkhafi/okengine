import { oke } from "okengine";
import { db } from "./core";
import { member, canBook, fair } from "./gates";
import {
  dbUrl,
  dbReplica1,
  anthropicKey,
  stripeKey,
} from "./vault";
import { bookingConfirmed } from "./channels";
import { orderPlaced, seatFeed } from "./flows/bookings/signals";
import { smart, fast, triage, embed, support } from "./ai";
import { create, mine, getBooking, refundBooking } from "./flows/bookings";
import { chargeBooking } from "./flows/payments";
import { send } from "./flows/notifications";
import {
  createTicket,
  askDocs,
  supportAgent,
} from "./flows/support";
import { me } from "./flows/users";
import { audit } from "./plugins/audit";
import "./journeys";
import "./flows/bookings";
import "./flows/payments";
import "./flows/notifications";
import "./flows/support";
import "./flows/users";
import "./ai";
import "./channels";
import "./gates";

export const app = oke({ name: "skyport" }).plug(audit);

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
    agents: [support],
  },
});

app.adopt(
  {
    bookings: { create, mine, getBooking, refundBooking },
    payments: { chargeBooking },
    notifications: { send },
    support: { createTicket, askDocs, supportAgent },
    users: { me },
  },
);

export type App = typeof app;
