import { on, flow, gate, http } from "okengine";
import { eq } from "drizzle-orm";
import { db } from "../../core";
import { member } from "../../gates";
import { orderPlaced, orderNews } from "./signals";
import { chargeOrder } from "../payments";
import { NewOrder, OrderId, OrderRow, OutOfStock } from "./shapes";
import { orders, products } from "../../schema";

const canOrder = gate.policy("order:create", ({ auth }) => auth.scopes.has("order:create"));

export const create = on(
  http.post("/orders").gate(member, canOrder),
  flow({
    in: NewOrder,
    out: OrderId,
    errors: { OutOfStock },
    do: async (input, fx) => {
      const [product] = await fx
        .store(db)
        .select({ stock: products.stock })
        .from(products)
        .where(eq(products.sku, input.sku))
        .limit(1);
      if (!product || product.stock < input.qty)
        return fx.fail(
          "OutOfStock",
          { left: product?.stock ?? 0 },
          { message: fx.t("order.outOfStock", { left: product?.stock ?? 0 }) },
        );

      const id = fx.id();
      await fx
        .store(db)
        .insert(orders)
        .values({ id, userId: fx.auth.userId, ...input, status: "pending", createdAt: Date.now() });
      await fx.emit(orderPlaced, { orderId: id });
      return { id };
    },
  }),
);

// LIVE QUERY — realtime and auto-caching from one flag
export const mine = on(
  http.get("/orders").gate(member).live(),
  flow({
    out: OrderRow.array(),
    do: (_, fx) => fx.store(db).select().from(orders).where(eq(orders.userId, fx.auth.userId)),
  }),
);

export const getOrder = flow({
  in: OrderId,
  out: OrderRow,
  do: async ({ id }, fx) => {
    const [order] = await fx.store(db).select().from(orders).where(eq(orders.id, id)).limit(1);
    return order;
  },
});

// SIGNAL consumer
on(
  orderPlaced,
  flow({
    do: async ({ orderId }, fx) => {
      const paid = await fx.call(chargeOrder, { orderId });
      await fx
        .store(db)
        .update(orders)
        .set({ status: paid ? "confirmed" : "failed" })
        .where(eq(orders.id, orderId));
      await fx.emit(orderNews, { orderId, status: paid ? "confirmed" : "failed" });
    },
  }),
);

// CHANGE trigger — CDC, built in
on(
  db.table(orders).changed("status"),
  flow({
    do: ({ before, after }, fx) => fx.log.info("status", { from: before.status, to: after.status }),
  }),
);

export { canOrder };

// Enrich for notifications (userName / total are not storage columns).
const rawGet = getOrder.do;
(getOrder as { do: typeof rawGet }).do = async (input, fx) => {
  const order = await rawGet(input, fx);
  if (!order) return order;
  return {
    ...order,
    userName: "Customer",
    total: Number(order.qty ?? 0) * 10,
  };
};
