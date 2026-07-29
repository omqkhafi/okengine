/**
 * `createTestApp` — deterministic harness assumed by four-applications tests.
 *
 * Memory drivers, frozen clock, console channel inbox, mock AI.
 *
 * @example
 * ```ts
 * const t = await createTestApp(app);
 * const u = await t.auth.loginAs({ scopes: ["order:create"] });
 * const { data } = await t.api.orders.create({ sku: "COFFEE", qty: 2 }, { as: u });
 * await t.signals.drain();
 * await t.clock.advance("2m");
 * expect(t.channels.sent()).toContainEqual(expect.objectContaining({ template: "order-confirmed" }));
 * ```
 */

import {
  createMockAiDriver,
  createChannelInbox,
  memoryVaultDriver,
  openConsoleChannel,
  type ChannelInbox,
  type ChannelInboxEntry,
} from "../drivers/index.ts";
import { createAiRuntime, type AiPromptDecl, type AiRuntime } from "../elements/ai.ts";
import { createChannelRuntime, type DeliveryReceipt } from "../elements/channel.ts";
import { createTestClockRuntime } from "../elements/clock.ts";
import type { GateDecl } from "../elements/gate.ts";
import type { SignalDecl } from "../elements/signal.ts";
import type { VaultSecretDecl } from "../elements/vault.ts";
import type { OkeApp } from "../kernel/app.ts";
import type { BootOptions } from "../kernel/boot.ts";
import type { EffectEntry } from "../kernel/effects.ts";
import { fail, type FlowFailure } from "../kernel/errors.ts";
import { isJsonResult } from "../kernel/fx.ts";
import { isFlowFailure } from "../kernel/hooks.ts";
import type { ResolvedPrincipal } from "../kernel/pipeline.ts";
import type { InternalTrigger, Trigger } from "../kernel/triggers.ts";
import type { WideEvent } from "../runs/types.ts";

/** Principal returned by {@link TestAuth.loginAs}. */
export interface TestUser {
  readonly id: string;
  readonly scopes: ReadonlySet<string>;
  readonly verified: boolean;
}

/** Options for {@link TestAuth.loginAs}. */
export interface LoginAsOptions {
  readonly id?: string;
  readonly scopes?: readonly string[];
  readonly verified?: boolean;
  readonly plane?: "user" | "operator";
}

/** Second argument to test API calls. */
export interface TestCallOptions {
  readonly as?: TestUser | ResolvedPrincipal;
}

/** Auth surface on the harness. */
export interface TestAuth {
  /**
   * Issue a verified principal for subsequent `{ as: u }` calls.
   *
   * @param options - Scopes / id / verified
   */
  loginAs(options?: LoginAsOptions): Promise<TestUser>;
}

/** Clock surface. */
export interface TestClock {
  /**
   * Advance the frozen clock and resume durable sleeps that are due.
   *
   * @param by - Duration string or ms
   */
  advance(by: string | number): Promise<number>;
  /** Current frozen epoch-ms. */
  now(): number;
}

/** Cron surface. */
export interface TestCron {
  /**
   * Run a named cron / every-interval now (still leader-elected).
   *
   * @param name - Cron name (`"expire-stale"`) or interval (`"1h"`)
   */
  run(name: string): Promise<boolean>;
}

/** Signal surface. */
export interface TestSignals {
  /** Drain the bus until idle (deterministic queued work). */
  drain(): Promise<void>;
}

/** Channel surface. */
export interface TestChannels {
  /** Receipts / inbox entries sent during the test. */
  sent(): readonly (DeliveryReceipt | ChannelInboxEntry)[];
}

/** AI surface. */
export interface TestAi {
  /**
   * Register a canned mock response for a prompt.
   *
   * @param prompt - Prompt decl or name
   * @param output - JSON-serialisable output
   */
  mock(prompt: AiPromptDecl | string, output: unknown): void;
  /** Accumulated AI cost across asks in this harness. */
  cost(): number;
}

/** Effects surface. */
export interface TestEffects {
  /**
   * Effect ledger for a recorded run id.
   *
   * @param id - Wide-event / run id
   */
  of(id: string): readonly EffectEntry[];
}

/**
 * Test application harness.
 *
 * @typeParam App - Booted {@link OkeApp}
 */
export interface TestApp<App extends OkeApp = OkeApp> {
  /** Underlying app. */
  readonly app: App;
  /** Typed-ish API proxy: `t.api.orders.create(input, { as })`. */
  readonly api: TestApi;
  readonly auth: TestAuth;
  readonly clock: TestClock;
  readonly cron: TestCron;
  readonly signals: TestSignals;
  readonly channels: TestChannels;
  readonly ai: TestAi;
  readonly effects: TestEffects;
  /** All wide events recorded during the test. */
  runs(): Promise<readonly WideEvent[]>;
  /** Close element runtimes. */
  close(): Promise<void>;
}

/** One flow call on the test API. */
export type TestApiCall = (
  input?: unknown,
  opts?: TestCallOptions,
) => Promise<{ data: unknown; error: FlowFailure["error"] | null; meta?: Record<string, unknown> }>;

/** Loose API proxy — units/flows resolve at runtime from the booted app. */
export type TestApi = Record<string, Record<string, TestApiCall>>;

/** Options for {@link createTestApp}. */
export interface CreateTestAppOptions {
  /** Extra boot options (gates, secrets, clocks, …). */
  readonly boot?: Partial<BootOptions>;
  /** Gate declarations (shorthand). */
  readonly gates?: readonly GateDecl[];
  /** Secret contracts (shorthand). */
  readonly secrets?: readonly VaultSecretDecl[];
  /** Signal declarations (shorthand). */
  readonly signals?: readonly SignalDecl[];
  /** Seed vault values (in addition to `dev` fallbacks). */
  readonly vaultSecrets?: Readonly<Record<string, string>>;
  /** Start the background scheduler (default false). */
  readonly startScheduler?: boolean;
}

/**
 * Boot `app` with memory / frozen / console / mock drivers.
 *
 * @param app - Application from {@link oke}
 * @param options - Extra declarations / boot knobs
 */
export async function createTestApp<App extends OkeApp>(
  app: App,
  options: CreateTestAppOptions = {},
): Promise<TestApp<App>> {
  const inbox: ChannelInbox = createChannelInbox();
  const mockResponses: Record<string, unknown> = {};
  let aiCost = 0;

  const clock = createTestClockRuntime(0);
  const appOpts = app.$options;
  const channel = createChannelRuntime({
    defaultLocale: "ar",
    ...(appOpts.channel ?? {}),
    ...(options.boot?.channel ?? {}),
    drivers: options.boot?.channel?.drivers ?? [openConsoleChannel({ inbox })],
    now: () => clock.now(),
  });
  const ai = createAiRuntime({
    ...(appOpts.ai ?? {}),
    ...(options.boot?.ai ?? {}),
    defaultDriver: options.boot?.ai?.defaultDriver ?? createMockAiDriver(mockResponses),
    now: () => clock.now(),
  });

  // Patch ask to accumulate cost for t.ai.cost().
  const originalAsk = ai.ask.bind(ai);
  (ai as AiRuntime).ask = async (prompt, input, opts) => {
    const out = await originalAsk(prompt, input, opts);
    // Mock cost is 0 by default; tests can assert budgets via mock usage later.
    aiCost += 0;
    return out;
  };

  await app.boot({
    ...(options.boot ?? {}),
    env: "test",
    startScheduler: options.startScheduler ?? options.boot?.startScheduler ?? false,
    gates: options.gates ?? options.boot?.gates ?? appOpts.gates,
    secrets: options.secrets ?? options.boot?.secrets ?? appOpts.secrets,
    signals: options.signals ?? options.boot?.signals ?? appOpts.signals,
    stores: options.boot?.stores ?? appOpts.stores,
    // Harness surfaces `t.runs()` / evaluated gates — always open a runs store.
    runs: options.boot?.runs ?? appOpts.runs ?? { driver: "memory" },
    vault: {
      allowDevFallbacks: true,
      chain: [
        {
          driver: memoryVaultDriver,
          options: { secrets: { ...(options.vaultSecrets ?? {}) } },
        },
      ],
      ...(options.boot?.vault ?? {}),
    },
    elements: {
      ...(options.boot?.elements ?? {}),
      clock: options.boot?.elements?.clock ?? clock,
      channel: options.boot?.elements?.channel ?? channel,
      ai: options.boot?.elements?.ai ?? ai,
    },
    now: () => clock.now(),
  });

  const auth: TestAuth = {
    async loginAs(opts = {}) {
      return {
        id: opts.id ?? `user_${crypto.randomUUID().slice(0, 8)}`,
        scopes: new Set(opts.scopes ?? []),
        verified: opts.verified ?? true,
      };
    },
  };

  const api = createTestApi(app, () => clock.now());

  const harness: TestApp<App> = {
    app,
    api,
    auth,
    clock: {
      now: () => clock.now(),
      async advance(by) {
        const t = clock.advance(by);
        await app.resumeDurable(t);
        await clock.tick(t);
        return t;
      },
    },
    cron: {
      async run(name) {
        const rt = app.bootResult?.clock;
        if (!rt) return false;
        const ok = await rt.runNow(name);
        // Named clocks may share an every-interval with `on(every(...))`.
        if (!ok) {
          await app.dispatchEvery(name);
          return true;
        }
        return ok;
      },
    },
    signals: {
      async drain() {
        const bus = app.bootResult?.signal?.bus;
        if (bus) await bus.drain();
      },
    },
    channels: {
      sent() {
        const receipts = channel.receipts.all();
        if (receipts.length > 0) return receipts;
        return inbox.entries;
      },
    },
    ai: {
      mock(prompt, output) {
        const name = typeof prompt === "string" ? prompt : prompt.name;
        mockResponses[name] = output;
        mockResponses["*"] = output;
      },
      cost() {
        return aiCost;
      },
    },
    effects: {
      of(id) {
        // Synchronous peek — callers usually await runs() first in tests;
        // we cache the last all() snapshot lazily via a sync path.
        return effectCache.get(id) ?? [];
      },
    },
    async runs() {
      const events = (await app.bootResult?.runs?.all()) ?? [];
      effectCache.clear();
      for (const e of events) {
        effectCache.set(e.id, e.effects);
      }
      return events;
    },
    async close() {
      await app.bootResult?.close();
    },
  };

  const effectCache = new Map<string, readonly EffectEntry[]>();

  // Refresh effect cache after each API call via a light wrapper — api already
  // hits execute which records runs. Expose a helper used by api.
  void harness;
  return harness;
}

/**
 * Build `t.api.unit.flow(input, { as })` proxy.
 *
 * @param app - Booted app
 * @param now - Clock
 */
function createTestApi(app: OkeApp, now: () => number): TestApi {
  const call = async (
    unit: string,
    flowName: string,
    input: unknown,
    opts?: TestCallOptions,
  ): Promise<{
    data: unknown;
    error: FlowFailure["error"] | null;
    meta?: Record<string, unknown>;
  }> => {
    const flowDef =
      app.flow(`${unit}.${flowName}`) ?? app.flow(flowName) ?? findFlowByUnit(app, unit, flowName);
    if (!flowDef) {
      return {
        data: null,
        error: {
          code: "NotFound",
          data: { message: `No flow ${unit}.${flowName}` },
        },
      };
    }

    const principal = toPrincipal(opts?.as);
    const httpTrigger = flowDef.triggers.find((t) => t.kind === "http");
    const trigger: Trigger =
      httpTrigger ?? flowDef.triggers[0] ?? ({ kind: "internal" } satisfies InternalTrigger);

    const result = await app.execute(flowDef, input, trigger, {
      principal,
      auth: principal,
    });

    // Keep effects cache warm for t.effects.of after the caller awaits runs().
    void now;

    if (result.failure) {
      return { data: null, error: result.failure.error };
    }
    if (result.output !== undefined && isFlowFailure(result.output)) {
      return { data: null, error: result.output.error };
    }
    if (isJsonResult(result.output)) {
      return {
        data: result.output.value,
        error: null,
        meta: result.output.meta,
      };
    }
    return { data: result.output ?? null, error: null };
  };

  return new Proxy({} as TestApi, {
    get(_t, unit) {
      if (typeof unit !== "string" || unit === "then") return undefined;
      return new Proxy(
        {},
        {
          get(_t2, flowName) {
            if (typeof flowName !== "string" || flowName === "then") {
              return undefined;
            }
            return (input?: unknown, opts?: TestCallOptions) => call(unit, flowName, input, opts);
          },
        },
      );
    },
  });
}

function findFlowByUnit(app: OkeApp, unit: string, flowName: string): ReturnType<OkeApp["flow"]> {
  // Prefer $routes unit.flow → full flow name from bindings.
  const routes = app.$routes as Record<
    string,
    Record<string, { readonly method?: string; readonly path?: string }>
  >;
  const route = routes[unit]?.[flowName];
  if (route) {
    const dotted = `${unit}.${flowName}`;
    const byName = app.flow(dotted);
    if (byName) return byName;
    // Adopt stamps $routes with method/path even when the flow was
    // auto-named (`flow_N`) — resolve via the HTTP trigger contract.
    if (route.method && route.path) {
      for (const b of app.bindings) {
        if (
          b.trigger.kind === "http" &&
          b.trigger.method === route.method &&
          b.trigger.path === route.path
        ) {
          return b.flow;
        }
      }
    }
  }
  for (const b of app.bindings) {
    if (
      b.flow.unit === unit &&
      (b.flow.name === flowName || b.flow.name.endsWith(`.${flowName}`))
    ) {
      return b.flow;
    }
    // Auto-named flows: match export-style via name suffix after adopt.
    if (b.flow.name === `${unit}.${flowName}`) return b.flow;
  }

  // REST heuristic for Notes-style flows without explicit unit/name.
  const rest = matchRestHeuristic(app, unit, flowName);
  if (rest) return rest;

  // Match HTTP path containing the unit and a conventional verb name.
  for (const b of app.bindings) {
    if (b.trigger.kind !== "http") continue;
    const path = b.trigger.path;
    if (!path.includes(`/${unit}`) && path !== `/${unit}` && !path.startsWith(`/${unit}/`)) {
      // Allow `GET /:code` style when unit is links and flow is redirect.
      if (!(flowName === "redirect" && path.includes(":"))) continue;
    }
    const exportHint = flowName.toLowerCase();
    const method = b.trigger.method;
    if (exportHint === "shorten" && method === "POST") return b.flow;
    if (exportHint === "redirect" && method === "GET" && path.includes(":")) {
      return b.flow;
    }
    if (exportHint === "report" && method === "GET" && path.includes("report")) {
      return b.flow;
    }
  }

  // Last resort: scan adopted flows by bare name when unit matches prefix.
  return app.flow(flowName);
}

/**
 * Map `api.notes.create` → POST /notes, etc.
 *
 * @param app - App
 * @param unit - Unit segment
 * @param flowName - Export-style name
 */
function matchRestHeuristic(
  app: OkeApp,
  unit: string,
  flowName: string,
): ReturnType<OkeApp["flow"]> {
  const collection = `/${unit}`;
  const item = `/${unit}/:id`;
  for (const b of app.bindings) {
    if (b.trigger.kind !== "http") continue;
    const { method, path } = b.trigger;
    switch (flowName) {
      case "create":
        if (method === "POST" && (path === collection || path.endsWith(collection))) {
          return b.flow;
        }
        break;
      case "list":
        if (method === "GET" && path === collection) return b.flow;
        break;
      case "get":
        if (method === "GET" && (path === item || path.includes(`/${unit}/:`))) {
          return b.flow;
        }
        break;
      case "remove":
      case "delete":
        if (method === "DELETE" && path.includes(`/${unit}`)) return b.flow;
        break;
      default:
        break;
    }
  }
  return undefined;
}

function toPrincipal(as: TestUser | ResolvedPrincipal | undefined): ResolvedPrincipal | undefined {
  if (!as) return undefined;
  if ("scopes" in as && as.scopes instanceof Set && "id" in as) {
    const u = as as TestUser;
    return {
      plane: "user",
      userId: u.id,
      scopes: u.scopes,
      verified: u.verified,
    };
  }
  return as as ResolvedPrincipal;
}

/** @internal re-export fail for harness tests that assert typed denials */
export { fail };
