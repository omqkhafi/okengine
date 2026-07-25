import { rateLimit, gate } from "okengine";
import { member } from "./gates";
import { stripeKey, dbUrl } from "./vault";
import { orderPlaced, orderNews } from "./flows/orders/signals";
import { orderConfirmed, otpCode } from "./channels";
import { db } from "./core";
import { chargeOrder } from "./flows/payments";
import { create, mine, getOrder } from "./flows/orders";

const canOrder = gate.policy("order:create", ({ auth: a }) =>
  a.scopes.has("order:create"),
);

import { oke } from "okengine";
import { auth } from "okengine/auth";
import { audit } from "./plugins/audit";
import { orders } from "./flows/orders";
import "./flows/payments";
import "./flows/notifications";

export const app = oke({ name: "provisions" })
  .plug(auth())                       // zero ceremony: uses your configured store
  .plug(audit)                        // app-wide
  .hook("onError", (ctx, err, fx) => fx.log.error(err));

orders.plug(rateLimit({ max: 30 }));  // this unit only

// Wire declarations the claimed block omits (boot / client / tests).
Object.assign(app.$options, {
  env: "test",
  gates: [member, canOrder],
  secrets: [stripeKey, dbUrl],
  signals: [orderPlaced, orderNews],
  stores: [db],
  channel: {
    templates: [orderConfirmed, otpCode],
    defaultLocale: "ar",
  },
});
app.adopt({ orders: { create, mine, getOrder } }, chargeOrder);

export type App = typeof app;
