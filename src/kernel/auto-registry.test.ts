/**
 * `oke({...})` auto-populates `stores` / `secrets` / `signals` /
 * `channel.templates` from the same kind of module-evaluation registry
 * already proven for `on()`'s trigger drain (`registry-isolation.test.ts`).
 *
 * `store.sql` / `store.files`, `vault.secret`, `signal()`, and medium-binder
 * `.template()` push into a shared registry (`src/kernel/element-registries.ts`)
 * at call time — zero change to how developers call them. `oke()` drains it
 * at construction under the same `registry: "consume" | "keep" | "ignore"`
 * switch that already governs bindings.
 */

import { describe, expect, test } from "bun:test";
import { channel } from "../elements/channel/declare.ts";
import { signal } from "../elements/signal/declare.ts";
import { store } from "../elements/store/declare.ts";
import { vault } from "../elements/vault/declare.ts";
import { oke } from "./app.ts";
import { flow } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { http } from "./triggers.ts";

describe("oke() auto-registry — stores/secrets/signals/channel.templates", () => {
  test("before/after: zero explicit arrays boots identically to the explicit-array form", async () => {
    resetBindings();

    // "before" — today's explicit-array form (registry: "ignore" so this
    // app cannot see anything auto-drained; proves the old path is unchanged).
    const dbBefore = store.sql("before-app", { schema: {} });
    const filesBefore = store.files("before-uploads");
    const secretBefore = vault.secret("BEFORE_WEBHOOK_SECRET", { dev: "dev-secret-before" });
    const signalBefore = signal("before-note-created", { delivery: "once", optional: true });
    const mailBefore = channel.email({ from: "Before <before@localhost>" });
    const templateBefore = mailBefore.template("before-note-created");

    const beforeFlow = flow("before.onCreated", {
      effects: {
        secrets: ["BEFORE_WEBHOOK_SECRET"],
        emits: ["before-note-created"],
        sends: ["before-note-created"],
      },
      do: async (_input, fx) => {
        const secret = await fx.vault.get(secretBefore);
        await fx.emit(signalBefore, {});
        await fx.send(templateBefore, { to: "you@localhost", data: {} });
        return { secret };
      },
    });
    on(http.post("/before"), beforeFlow);

    const appBefore = oke({
      name: "before-app",
      registry: "ignore",
      bindings: [{ trigger: http.post("/before"), flow: beforeFlow }],
      gate: { unguardedHttp: "allow" },
      vault: { allowDevFallbacks: true },
      stores: [dbBefore, filesBefore],
      secrets: [secretBefore],
      signals: [signalBefore],
      channel: { templates: [templateBefore] },
      startScheduler: false,
    });

    // "after" — same shape, zero explicit arrays; registry auto-populates.
    // Declared (and registered) for their side effect only — never passed
    // to `oke()` directly, proving the registry alone carries them.
    store.sql("after-app", { schema: {} });
    store.files("after-uploads");
    const secretAfter = vault.secret("AFTER_WEBHOOK_SECRET", { dev: "dev-secret-after" });
    const signalAfter = signal("after-note-created", { delivery: "once", optional: true });
    const mailAfter = channel.email({ from: "After <after@localhost>" });
    const templateAfter = mailAfter.template("after-note-created");

    const afterFlow = flow("after.onCreated", {
      effects: {
        secrets: ["AFTER_WEBHOOK_SECRET"],
        emits: ["after-note-created"],
        sends: ["after-note-created"],
      },
      do: async (_input, fx) => {
        const secret = await fx.vault.get(secretAfter);
        await fx.emit(signalAfter, {});
        await fx.send(templateAfter, { to: "you@localhost", data: {} });
        return { secret };
      },
    });
    resetBindings();
    on(http.post("/after"), afterFlow);

    const appAfter = oke({
      name: "after-app",
      gate: { unguardedHttp: "allow" },
      vault: { allowDevFallbacks: true },
      startScheduler: false,
      // No stores / secrets / signals / channel — registry supplies them.
    });

    await appBefore.boot({ env: "test", unguardedHttp: "allow" });
    await appAfter.boot({ env: "test", unguardedHttp: "allow" });

    // Both boots resolved the same shape from stores → secrets → signals → channel.
    expect(appBefore.bootResult?.store?.declarations.has("sql:before-app")).toBe(true);
    expect(appBefore.bootResult?.store?.declarations.has("files:before-uploads")).toBe(true);
    expect(appAfter.bootResult?.store?.declarations.has("sql:after-app")).toBe(true);
    expect(appAfter.bootResult?.store?.declarations.has("files:after-uploads")).toBe(true);

    expect(appBefore.bootResult?.vault?.contracts.has("BEFORE_WEBHOOK_SECRET")).toBe(true);
    expect(appAfter.bootResult?.vault?.contracts.has("AFTER_WEBHOOK_SECRET")).toBe(true);
    expect(appBefore.bootResult?.vault?.read("BEFORE_WEBHOOK_SECRET")).toBe("dev-secret-before");
    expect(appAfter.bootResult?.vault?.read("AFTER_WEBHOOK_SECRET")).toBe("dev-secret-after");

    expect(appBefore.bootResult?.signal?.declarations.has("before-note-created")).toBe(true);
    expect(appAfter.bootResult?.signal?.declarations.has("after-note-created")).toBe(true);

    expect(appBefore.bootResult?.channel?.templates.has("before-note-created")).toBe(true);
    expect(appAfter.bootResult?.channel?.templates.has("after-note-created")).toBe(true);

    // Same flow execution shape through the real HTTP path either way —
    // both resolve, emit, and send successfully; the secret value itself
    // comes back redacted (fx output redaction), same on both sides.
    const resBefore = await appBefore.fetch(
      new Request("http://localhost/before", { method: "POST" }),
    );
    const resAfter = await appAfter.fetch(
      new Request("http://localhost/after", { method: "POST" }),
    );
    expect(resBefore.status).toBe(200);
    expect(resAfter.status).toBe(200);
    const bodyBefore = (await resBefore.json()) as { data: { secret: string } };
    const bodyAfter = (await resAfter.json()) as { data: { secret: string } };
    expect(bodyBefore.data.secret).toBe(bodyAfter.data.secret);
  });

  test("explicit passing is additive, never silently ignored — same object via both paths is deduped, not doubled", async () => {
    const db = store.sql("dedup-app", { schema: {} });

    // `db` is already sitting in the registry from the call above *and*
    // passed explicitly — must not double-register / conflict.
    const app = oke({
      name: "dedup-app",
      autoBoot: false,
      stores: [db],
      startScheduler: false,
    });

    await app.boot({ env: "test", unguardedHttp: "allow" });
    expect(app.bootResult?.store?.declarations.has("sql:dedup-app")).toBe(true);
  });

  test('registry: "ignore" does not auto-populate', async () => {
    vault.secret("IGNORED_SECRET", { description: "never passed, never auto-read" });

    const app = oke({
      name: "ignore-mode-app",
      registry: "ignore",
      startScheduler: false,
    });
    // Nothing requires the secret, so boot succeeds — but it must not have
    // silently picked up IGNORED_SECRET from the registry either way.
    await app.boot({ env: "test", unguardedHttp: "allow" });
    expect(app.bootResult?.vault?.contracts.has("IGNORED_SECRET")).toBeFalsy();
  });

  test('registry: "consume" (default) drains stores/secrets/signals/channel.templates — a later app does not inherit them', async () => {
    store.sql("leak-app", { schema: {} });
    vault.secret("LEAK_SECRET", { dev: "dev-leak" });
    signal("leak-signal", { delivery: "once" });
    channel.email().template("leak-template");

    const appA = oke({
      name: "leak-app-a",
      autoBoot: false,
      vault: { allowDevFallbacks: true },
      startScheduler: false,
    });
    await appA.boot({ env: "test", unguardedHttp: "allow" });
    expect(appA.bootResult?.store?.declarations.has("sql:leak-app")).toBe(true);
    expect(appA.bootResult?.vault?.contracts.has("LEAK_SECRET")).toBe(true);

    // Second app, constructed after the first drained the registry.
    const appB = oke({
      name: "leak-app-b",
      autoBoot: false,
      startScheduler: false,
    });
    await appB.boot({ env: "test", unguardedHttp: "allow" });
    // Nothing was passed and nothing was left in the registry (App A drained
    // it) — App B needed store/vault/signal not at all, so no runtime was
    // built for them. Channel boots unconditionally regardless of registry
    // content (pre-existing, unrelated to this feature — `resolveElementNeeds`
    // gates channel on object *presence*, not template count) — assert its
    // template map, not runtime absence.
    expect(appB.bootResult?.store).toBeUndefined();
    expect(appB.bootResult?.vault).toBeUndefined();
    expect(appB.bootResult?.signal).toBeUndefined();
    expect(appB.bootResult?.channel?.templates.has("leak-template") ?? false).toBe(false);
  });
});
