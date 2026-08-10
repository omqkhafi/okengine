/**
 * Builtin `console` plugin — panels, tables, operator-plane hooks.
 *
 * Uses only the public plugin API (unified-theory §14).
 */

import { fail, plugin, type Fx, type PluginDef } from "../../kernel/index.ts";
import { PUBLIC_CONSOLE_FLOWS } from "./public-flows.ts";

/**
 * Builtin Console plugin.
 *
 * @returns Plugin definition
 */
export function consolePlugin(): PluginDef {
  return (
    plugin("console", { version: "0.0.1" })
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
      .table("oke_console_prefs", undefined, { plane: "operator" })
      // Public flows must not 401 when a stale Bearer/cookie is present —
      // kernel onAuth verifies before beforeHandle's public-flow exemption.
      // Rebuild from URL so Authorization is dropped (mutating Headers in place
      // can leave the header visible to later stages).
      //
      // `app.fetch` parseValidate may already have consumed the body before
      // this hook runs — never re-wrap a used stream (throws
      // "ReadableStream has already been used" on claim/login).
      .hook("onRequest", (ctx) => {
        if (!PUBLIC_CONSOLE_FLOWS.has(ctx.flow.name) || !ctx.request) return;
        const auth = ctx.request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) return;
        const headers = new Headers();
        for (const [key, value] of ctx.request.headers) {
          if (key.toLowerCase() === "authorization") continue;
          headers.set(key, value);
        }
        const method = ctx.request.method;
        const init: RequestInit = { method, headers };
        if (
          method !== "GET" &&
          method !== "HEAD" &&
          ctx.request.body !== null &&
          !ctx.request.bodyUsed
        ) {
          init.body = ctx.request.body;
          (init as RequestInit & { duplex: "half" }).duplex = "half";
        }
        ctx.request = new Request(ctx.request.url, init);
      })
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
      })
  );
}
