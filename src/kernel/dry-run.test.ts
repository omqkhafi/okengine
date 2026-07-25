import { describe, expect, test } from "bun:test";
import type { ChannelRuntime } from "../elements/channel/runtime.ts";
import {
  isDryRun,
  withDryRun,
} from "./dry-run.ts";
import { createFx, type FxStubStoreHandle } from "./fx.ts";

describe("fx dry-run stubbing", () => {
  test("send/ask are intercepted; writes still execute then roll back", async () => {
    let realSends = 0;
    let realAsks = 0;
    const channelRuntime = {
      async send() {
        realSends += 1;
        return { ok: true as const, receiptId: "r" };
      },
    } as unknown as ChannelRuntime;
    const aiRuntime = {
      async ask() {
        realAsks += 1;
        return { answer: "nope" };
      },
    };

    const stockRow = { qty: 100 };
    const fx = createFx({
      flow: "test.dry",
      effects: {
        reads: ["sql:t"],
        writes: ["sql:t"],
        sends: ["mail"],
        asks: ["p@1"],
      },
      channelRuntime,
      aiRuntime: aiRuntime as never,
      storeData: { "sql:t": { sku: stockRow } },
    });

    const stubbed = await withDryRun(async () => {
      expect(isDryRun()).toBe(true);
      const store = fx.store("sql:t") as FxStubStoreHandle;
      const row = (await store.get("sku")) as { qty: number };
      row.qty -= 1;
      await store.set("sku", row);
      expect(((await store.get("sku")) as { qty: number }).qty).toBe(99);
      await fx.send("mail", { to: "a@b.c" });
      await fx.ask("p@1", {});
      return store.get("sku");
    });

    expect(await stubbed.result).toEqual({ qty: 99 });
    expect(realSends).toBe(0);
    expect(realAsks).toBe(0);
    expect(stubbed.wouldHaveFired).toEqual([
      { kind: "send", resource: "mail" },
      { kind: "ask", resource: "p@1" },
    ]);
    // Rolled back — store is byte-for-byte restored.
    const store = fx.store("sql:t") as FxStubStoreHandle;
    expect(await store.get("sku")).toEqual({ qty: 100 });
    expect(stockRow.qty).toBe(100);
  });
});
