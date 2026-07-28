import { describe, expect, test } from "bun:test";
import { signal } from "./declare.ts";
import { createMemorySignalConfigStore, reconcileSignals } from "./reconcile.ts";

describe("reconcileSignals", () => {
  test("marks a removed signal orphaned without deleting it", async () => {
    const store = createMemorySignalConfigStore();
    const a = signal("order-placed", { delivery: "once" });
    const b = signal("legacy-shipped", { delivery: "once" });

    await reconcileSignals([a, b], store);
    const second = await reconcileSignals([a], store);

    expect(second.active).toEqual(["order-placed"]);
    expect(second.orphaned).toEqual(["legacy-shipped"]);
    const orphan = second.rows.find((r) => r.name === "legacy-shipped");
    expect(orphan?.status).toBe("orphaned");
    expect(orphan?.delivery).toBe("once");
  });
});
