import { rateLimit } from "okengine";
import { member } from "./gates";
import { canOrder } from "./flows/orders";
import { stripeKey, dbUrl } from "./vault";
import { orderPlaced, orderNews } from "./flows/orders/signals";
import { orderConfirmed, otpCode } from "./channels";
import { db } from "./core";
import { products } from "./schema";

import { oke } from "okengine";
import { auth } from "okengine/auth";
import { audit } from "./plugins/audit";
import * as orders from "./flows/orders";
import * as payments from "./flows/payments";
import * as notifications from "./flows/notifications";

export const app = oke({ name: "provisions" })
  .adopt({ orders, payments, notifications })
  .plug(auth())                       // zero ceremony: uses your configured store
  .plug(audit)                        // app-wide
  .hook("onError", (ctx, err, fx) => fx.log.error(err));

app.unit("orders").plug(rateLimit({ max: 30 }));  // this unit only

export type App = typeof app;

Object.assign(app.$options, {
  gates: [member, canOrder],
  secrets: [stripeKey, dbUrl],
  signals: [orderPlaced, orderNews],
  stores: [db],
  channel: {
    templates: [orderConfirmed, otpCode],
    defaultLocale: "ar",
  },
});

const boot = app.boot.bind(app);
app.boot = async (opts) => {
  const result = await boot(opts);
  // `app.boot()` returns the app; the runtime is on `bootResult`.
  const store = app.bootResult?.store;
  if (store) {
    const sql = await store.open(db, {
      effects: { writes: ["sql:provisions"] },
    });
    if ("exists" in sql && "insert" in sql) {
      const existing = await sql.exists(products, { sku: "COFFEE" });
      if (!existing) {
        await sql.insert(products).values({
          sku: "COFFEE",
          name: "Coffee",
          stock: 100,
        });
      }
    }
  }
  return result;
};
