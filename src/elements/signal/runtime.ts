/**
 * Signal runtime — binds declarations to a protocol driver and exposes
 * emit / subscribe / live / drain for `fx` and tests.
 */

import type {
  DeadLetter,
  SignalBus,
  SignalDriver,
  SignalEmitOptions,
} from "../../drivers/signal-types.ts";
import type { SignalDecl } from "./declare.ts";

/** Options for {@link createSignalRuntime}. */
export interface CreateSignalRuntimeOptions {
  /** Protocol driver (`memory` · `postgres` · `redis` · `nats`). */
  readonly driver: SignalDriver;
  /** Clock. */
  readonly now?: () => number;
  /** Visibility lease for `once` claims (ms). */
  readonly leaseMs?: number;
  /** Durable path for chaos recovery. */
  readonly durablePath?: string;
  /** Injected clients forwarded to the driver. */
  readonly sql?: unknown;
  readonly redis?: import("../../drivers/signal-types.ts").SignalRedisClientLike;
  readonly nats?: import("../../drivers/signal-types.ts").SignalNatsClientLike;
}

/** Signal runtime. */
export interface SignalRuntime {
  /** Bound protocol driver id (`memory` · `postgres` · `redis` · `nats`). */
  readonly driverId: string;
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
   * @param options - Optional emit options (`key` for per-key once ordering)
   */
  emit(name: string, payload?: unknown, options?: SignalEmitOptions): Promise<void>;
  /**
   * Dead-lettered messages for one signal (auto-starts).
   *
   * @param name - Signal name
   */
  deadLetters(name: string): Promise<readonly DeadLetter[]>;
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
    driverId: options.driver.id,
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
        leaseMs: options.leaseMs,
        durablePath: options.durablePath,
        sql: options.sql,
        redis: options.redis,
        nats: options.nats,
      });
      return bus;
    },
    async emit(name, payload, options) {
      const b = await this.start();
      await b.emit(name, payload, options);
    },
    async deadLetters(name) {
      const b = await this.start();
      return b.deadLetters(name);
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
