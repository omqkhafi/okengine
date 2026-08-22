/**
 * Live HTTP exposure uniqueness (OKE1013) and GET-only synthesis.
 */

import { describe, expect, test, beforeEach } from "bun:test";
import { z } from "zod";
import { gate } from "../elements/gate.ts";
import { signal, resetSignals } from "../elements/signal/declare.ts";
import { oke } from "./app.ts";
import { resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { stampFlowName } from "./stamp-http.ts";
import { http } from "./triggers.ts";

const member = gate.policy("member", ({ auth }) => !!auth.verified);
const admin = gate.policy("admin", ({ auth }) => !!auth.verified);
const partner = gate.policy("partner", ({ auth }) => !!auth.verified);

const orderStatus = () =>
  signal("order-status", {
    delivery: "live",
    optional: true,
    schema: z.object({
      orderId: z.string(),
      status: z.enum(["placed", "fulfilling", "shipped"]),
    }),
  });

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
  resetSignals();
});

describe("live HTTP uniqueness", () => {
  test("member :orderId + admin firehose both boot", () => {
    const sig = orderStatus();
    const events = on(http.get("/orders/:orderId/events").gate(member).live(sig));
    const feed = on(http.get("/admin/order-status").gate(admin).live(sig));
    stampFlowName(events, "orders.events");
    stampFlowName(feed, "admin.adminFeed");
    expect(() => oke({ name: "t", autoBoot: false })).not.toThrow();
  });

  test("same match, different gates boot (via disambiguates on the client)", () => {
    const sig = orderStatus();
    const a = on(http.get("/orders/:orderId/events").gate(member).live(sig));
    const b = on(http.get("/partners/:orderId/events").gate(partner).live(sig));
    stampFlowName(a, "orders.events");
    stampFlowName(b, "partners.events");
    expect(() => oke({ name: "t", autoBoot: false })).not.toThrow();
  });

  test("two member firehoses on different paths fail OKE1013", () => {
    const sig = orderStatus();
    const a = on(http.get("/feed-a").gate(member).live(sig));
    const b = on(http.get("/feed-b").gate(member).live(sig));
    stampFlowName(a, "orders.feedA");
    stampFlowName(b, "orders.feedB");
    expect(() => oke({ name: "t", autoBoot: false })).toThrow(/OKE1013/);
  });

  test("duplicate GET path still OKE1011", () => {
    const sig = orderStatus();
    const a = on(http.get("/orders/:orderId/events").gate(member).live(sig));
    const b = on(http.get("/orders/:orderId/events").gate(admin).live(sig));
    stampFlowName(a, "orders.events");
    stampFlowName(b, "admin.events");
    expect(() => oke({ name: "t", autoBoot: false })).toThrow(/OKE1011/);
  });

  test("POST .live(signal) is rejected", () => {
    const sig = orderStatus();
    expect(() => on(http.post("/orders").gate(member).live(sig))).toThrow(
      /live exposure must be GET/,
    );
  });
});
