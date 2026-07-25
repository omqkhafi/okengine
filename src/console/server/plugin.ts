/**
 * Builtin `console` plugin — panels, tables, operator-plane hooks.
 *
 * Uses only the public plugin API (unified-theory §14).
 */

import {
  fail,
  plugin,
  type Fx,
  type PluginDef,
} from "../../kernel/index.ts";
import { PUBLIC_CONSOLE_FLOWS } from "./flows.ts";

/**
 * Builtin Console plugin.
 *
 * @returns Plugin definition
 */
export function consolePlugin(): PluginDef {
  return plugin("console", { version: "0.0.1" })
    .consolePanel({
      id: "overview",
      title: "Overview",
      entry: "./panels/overview.js",
    })
    .consolePanel({
      id: "traces",
      title: "Traces",
      entry: "./panels/traces.js",
    })
    .table("oke_console_prefs", { plane: "operator" })
    .hook("beforeHandle", (ctx, fxOrErr) => {
      const fx = fxOrErr as Fx;
      const name = ctx.flow.name;
      const plane = ctx.flow.plane ?? "user";

      // Application principals never reach operator-plane flows.
      if (plane === "operator" && fx.auth.userId && !fx.operator.id) {
        return fail("Forbidden", {
          reason: "application principal cannot reach a console flow",
        });
      }

      if (PUBLIC_CONSOLE_FLOWS.has(name)) return;
      if (plane === "operator" && !fx.operator.id) {
        return fail("Unauthorized", {});
      }
    });
}
