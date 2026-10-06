/**
 * `fx.store().transaction` publishes signal emits only after commit.
 */

import { describe, expect, test } from "bun:test";
import type { SqlConnection } from "../drivers/types.ts";
import { memorySignalDriver } from "../drivers/signal-memory.ts";
import { signal } from "../elements/signal.ts";
import { store } from "../elements/store.ts";
import { createSqlStoreHandle } from "../elements/store/sql-session.ts";
import type { StoreRuntime } from "../elements/store/runtime.ts";
import { createFxContext } from "./fx.ts";
import type { SignalRuntime } from "../elements/signal/runtime.ts";

function fakeSql(): SqlConnection {
  return {
    driverId: "memory",
    role: "primary",
    async query() {
      return [];
    },
    async exec() {
      return { changes: 1 };
    },
    async transaction(fn) {
      return fn(this);
    },
    async close() {},
  };
}

describe("fx.store().transaction", () => {
  test("commit publishes the staged emit; rollback drops it", async () => {
    const ping = signal.once("ping");
    const signals = new Map([[ping.name, ping]]);
    const bus = await memorySignalDriver.open({ signals });
    const got: unknown[] = [];
    await bus.subscribe("ping", "c", async (message) => {
      got.push(message.payload);
    });
    const signalRuntime: SignalRuntime = {
      driverId: "memory",
      get bus() {
        return bus;
      },
      declarations: signals,
      register(decl) {
        signals.set(decl.name, decl);
      },
      async start() {
        return bus;
      },
      emit: (name, payload, options) => bus.emit(name, payload, options),
      deadLetters: (name) => bus.deadLetters(name),
      live: (name, opts) => bus.live(name, opts),
      checkLiveResume: (name, afterId) => bus.checkLiveResume(name, afterId),
      async close() {
        await bus.close();
      },
    };
    const notes = { name: "notes" };
    const storeRuntime = {
      async open() {
        return createSqlStoreHandle("sql:db", {
          connection: fakeSql(),
          classifications: new Map(),
          routedRole: "primary",
        });
      },
    } as unknown as StoreRuntime;
    const db = store.sql("db");
    const { fx } = createFxContext({
      flow: "notes.write",
      effects: { writes: ["sql:notes", "sql:db"], emits: ["ping"] },
      storeRuntime,
      signalRuntime,
    });

    await fx.store(db).transaction(async (tx) => {
      await tx.insert(notes).values({ id: "1" });
      await fx.emit(ping, { id: "1" });
    });
    await bus.drain();
    expect(got).toEqual([{ id: "1" }]);

    await expect(
      fx.store(db).transaction(async () => {
        await fx.emit(ping, { id: "no" });
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
    await bus.drain();
    expect(got).toEqual([{ id: "1" }]);
  });
});
