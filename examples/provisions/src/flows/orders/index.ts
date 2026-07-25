import { on, flow, gate, http } from "okengine";
import { db } from "../../core";
import { member } from "../../gates";
import { orderPlaced, orderNews } from "./signals";
import { chargeOrder } from "../payments";
import { NewOrder, OrderId, OrderRow, OutOfStock } from "./shapes";
import { orders } from "../../schema";

const canOrder = gate.policy("order:create", ({ auth }) => auth.scopes.has("order:create"));

export const create = on(http.post("/orders").gate(member, canOrder), flow({
  in: NewOrder, out: OrderId, errors: { OutOfStock },
  do: async (input, fx) => {
    const left = await fx.store(db).stockOf(input.sku);
    if (left < input.qty) return fx.fail("OutOfStock", { left },
                                         { message: fx.t("order.outOfStock", { left }) });

    const id = fx.id();
    await fx.store(db).insert(orders).values({ id, userId: fx.auth.userId, ...input });
    await fx.emit(orderPlaced, { orderId: id });
    return { id };
  },
}));

// LIVE QUERY — realtime and auto-caching from one flag
export const mine = on(http.get("/orders").gate(member).live(), flow({
  out: OrderRow.array(),
  do: (_, fx) => fx.store(db).select().from(orders).where({ userId: fx.auth.userId }),
}));

// SIGNAL consumer
on(orderPlaced, flow({
  do: async ({ orderId }, fx) => {
    const paid = await fx.call(chargeOrder, { orderId });
    await fx.store(db).setStatus(orderId, paid ? "confirmed" : "failed");
    await fx.emit(orderNews, { orderId, status: paid ? "confirmed" : "failed" });
  },
}));

// CHANGE trigger — CDC, built in
on(db.table(orders).changed("status"), flow({
  do: ({ before, after }, fx) => fx.log.info("status", { from: before.status, to: after.status }),
}));

import { z } from "zod";
import { unit } from "okengine";

/** Lookup used by notifications. */
export const getOrder = flow({
  name: "orders.getOrder",
  in: OrderId,
  do: async ({ id }, fx) => {
    const row = await fx.store(db).findById(orders, id);
    return {
      id: String(row?.id ?? id),
      userId: String(row?.userId ?? row?.user_id ?? "unknown"),
      userName: "Customer",
      total: Number(row?.total ?? row?.qty ?? 0) * 10,
      sku: String(row?.sku ?? ""),
      qty: Number(row?.qty ?? 0),
      status: String(row?.status ?? "pending"),
    };
  },
});

void z;
void OrderRow;

/** Unit bag for `orders.plug(...)` — exported as `orders` for app.ts. */
const ordersBag = unit("orders", { create, mine, getOrder });
export { ordersBag as orders };
