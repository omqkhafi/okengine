import { describe, expect, test } from "bun:test";
import { oke } from "./app.ts";
import { flow } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { plugin } from "./plugin.ts";
import { assertPluginNeeds, PluginNeedsError, buildAvailableNeedTokens } from "./plugin-needs.ts";
import { http } from "./triggers.ts";
import { resetFlowSeq } from "./flow.ts";
import { gate } from "../elements/gate.ts";

describe("plugin .needs() resolution", () => {
  test("plugin-name dependency fails when missing", () => {
    expect(() =>
      assertPluginNeeds(
        {
          twoFactor: {
            name: "twoFactor",
            version: "0.0.1",
            declares: [],
            intercepts: [],
            needs: ["auth"],
          },
        },
        { pluginNames: new Set(["twoFactor"]), available: new Set() },
      ),
    ).toThrow(PluginNeedsError);
  });

  test("plugin-name dependency passes when plugged", () => {
    expect(() =>
      assertPluginNeeds(
        {
          auth: {
            name: "auth",
            version: "0.0.1",
            declares: [],
            intercepts: [],
            needs: [],
          },
          twoFactor: {
            name: "twoFactor",
            version: "0.0.1",
            declares: [],
            intercepts: [],
            needs: ["auth"],
          },
        },
        {
          pluginNames: new Set(["auth", "twoFactor"]),
          available: new Set(),
        },
      ),
    ).not.toThrow();
  });

  test("element token store.sql from available set", () => {
    const available = buildAvailableNeedTokens({ elements: { storeSql: true } });
    expect(available.has("store.sql")).toBe(true);
    expect(() =>
      assertPluginNeeds(
        {
          auth: {
            name: "auth",
            version: "0.0.1",
            declares: ["table:oke_sessions"],
            intercepts: [],
            needs: ["store.sql"],
          },
        },
        { pluginNames: new Set(["auth"]), available },
      ),
    ).not.toThrow();
  });

  test("boot fails when plugin needs missing peer plugin", async () => {
    resetBindings();
    resetFlowSeq();
    on(http.get("/x").gate(gate.public), flow({ name: "x", do: () => ({ ok: true }) }));
    const dependent = plugin("needs-auth", { version: "0.0.1" }).needs("auth");
    const app = oke({ name: "needs-boot", gate: { policies: [gate.public] } }).plug(dependent);
    await expect(app.boot({ env: "test" })).rejects.toThrow(PluginNeedsError);
  });
});
