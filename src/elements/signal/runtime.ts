/**
 * Signal runtime — binds declarations to a protocol driver and exposes
 * emit / subscribe / live / drain for `fx` and tests.
 */

import type { SignalDriver, SignalBus } from "../../drivers/signal-types.ts";
import type { SignalDecl } from "./declare.ts";

/** Options for {@link createSignalRuntime}. */
export interface CreateSignalRuntimeOptions {
  /** Protocol driver (`memory` · `postgres` · `redis` · `nats`). */
  readonly driver: SignalDriver;
  /** Clock. */
  readonly now?: () => number;
  /** Durable path for chaos recovery. */
  readonly durablePath?: string;
  /** Injected clients forwarded to the driver. */
  readonly sql?: unknown;
  readonly redis?: import("../../drivers/signal-types.ts").SignalRedisClientLike;
  readonly nats?: import("../../drivers/signal-types.ts").SignalNatsClientLike;
}

/** Signal runtime. */
export interface SignalRuntime {
  /** Underlying bus (after {@link SignalRuntime.start}). */
  readonly bus: SignalBus | null;
  /**
   * Register a signal declaration.
   *
   * @param decl - From {@link signal}
   */
  register(decl: SignalDecl): void;
  /** Registered declarations. */
  readonly declarations: ReadonlyMap<string, SignalDecl>;
  /**
   * Open the driver bus. Idempotent.
   */
  start(): Promise<SignalBus>;
  /**
   * Emit via the bus (auto-starts).
   *
   * @param name - Signal name
   * @param payload - Payload
   */
  emit(name: string, payload?: unknown): Promise<void>;
  /** Close the bus. */
  close(): Promise<void>;
}

/**
 * Create a signal runtime bound to one protocol driver.
 *
 * @param options - Driver and bindings
 */
export function createSignalRuntime(options: CreateSignalRuntimeOptions): SignalRuntime {
  const declarations = new Map<string, SignalDecl>();
  let bus: SignalBus | null = null;

  const runtime: SignalRuntime = {
    get bus() {
      return bus;
    },
    declarations,
    register(decl) {
      declarations.set(decl.name, decl);
    },
    async start() {
      if (bus) return bus;
      bus = await options.driver.open({
        signals: declarations,
        now: options.now,
        durablePath: options.durablePath,
        sql: options.sql,
        redis: options.redis,
        nats: options.nats,
      });
      return bus;
    },
    async emit(name, payload) {
      const b = await this.start();
      await b.emit(name, payload);
    },
    async close() {
      if (bus) {
        await bus.close();
        bus = null;
      }
    },
  };

  return runtime;
}
