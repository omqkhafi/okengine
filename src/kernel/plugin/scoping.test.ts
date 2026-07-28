/**
 * Attachment-point scoping — proven by test, not by convention.
 *
 * Gate: bun test src/kernel/plugin
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { oke } from "../app.ts";
import { flow, resetFlowSeq } from "../flow.ts";
import { on, resetBindings } from "../on.ts";
import { plugin } from "../plugin.ts";
import { http } from "../triggers.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

describe("plugin scoping — attachment point is the scope", () => {
  test("unit-scoped plugin hook does not fire for another unit's flows", async () => {
    const fired: string[] = [];

    const ordersFlow = flow({
      name: "orders.create",
      unit: "orders",
      do: () => {
        fired.push("orders:handler");
        return { ok: true };
      },
    });

    const paymentsFlow = flow({
      name: "payments.charge",
      unit: "payments",
      do: () => {
        fired.push("payments:handler");
        return { ok: true };
      },
    });

    on(http.get("/orders"), ordersFlow);
    on(http.get("/payments"), paymentsFlow);

    const rateLimit = plugin("rate-limit", {
      version: "1.0.0",
      config: { max: 30 },
    }).hook("beforeHandle", () => {
      fired.push("rate-limit");
    });

    const app = oke({ name: "scoping" });
    app.unit("orders").plug(rateLimit);

    await app.fetch(new Request("http://localhost/orders"));
    await app.fetch(new Request("http://localhost/payments"));

    expect(fired).toEqual(["rate-limit", "orders:handler", "payments:handler"]);
  });

  test("app-scoped plugin hook fires for every unit", async () => {
    const fired: string[] = [];

    on(
      http.get("/a"),
      flow({
        name: "a",
        unit: "alpha",
        do: () => {
          fired.push("a");
          return {};
        },
      }),
    );
    on(
      http.get("/b"),
      flow({
        name: "b",
        unit: "beta",
        do: () => {
          fired.push("b");
          return {};
        },
      }),
    );

    const audit = plugin("audit", { version: "1.0.0" }).hook("afterHandle", () => {
      fired.push("audit");
    });

    const app = oke({ name: "app-scope" }).plug(audit);

    await app.fetch(new Request("http://localhost/a"));
    await app.fetch(new Request("http://localhost/b"));

    expect(fired).toEqual(["a", "audit", "b", "audit"]);
  });

  test("flow-scoped plugin hook fires only for that flow", async () => {
    const fired: string[] = [];

    const marked = flow({
      name: "marked",
      do: () => {
        fired.push("marked");
        return {};
      },
    }).plug(
      plugin("mark", { version: "1.0.0" }).hook("beforeHandle", () => {
        fired.push("mark-hook");
      }),
    );

    const plain = flow({
      name: "plain",
      do: () => {
        fired.push("plain");
        return {};
      },
    });

    on(http.get("/marked"), marked);
    on(http.get("/plain"), plain);

    const app = oke({ name: "flow-scope" });

    await app.fetch(new Request("http://localhost/marked"));
    await app.fetch(new Request("http://localhost/plain"));

    expect(fired).toEqual(["mark-hook", "marked", "plain"]);
  });
});
