/**
 * In-process signal engine — delivery physics, DLQ, transactions, durability.
 *
 * Used directly by the `memory` driver and as the transactional outbox that
 * redis / nats relay from after commit.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { SignalDecl } from "../elements/signal/declare.ts";
import type { SignalDelivery } from "../manifest/types.ts";
import type {
  DeadLetter,
  LiveHandler,
  SignalBus,
  SignalDriverId,
  SignalFailureReason,
  SignalHandler,
  SignalMessage,
  SignalOpenOptions,
  SignalTransaction,
  SignalUnsubscribe,
} from "./signal-types.ts";

/** Internal mutable message. */
interface MutMessage {
  id: string;
  signal: string;
  payload: unknown;
  delivery: SignalDelivery;
  attempts: number;
  failures: SignalFailureReason[];
  createdAt: number;
  availableAt: number;
  status: "pending" | "inflight" | "delivered" | "dead";
  /** For once: which consumer holds the claim. */
  lockedBy: string | null;
  /** For broadcast: subscriber ids that already received. */
  deliveredTo: Set<string>;
}

/** Persisted snapshot for chaos recovery. */
interface Snapshot {
  messages: Array<
    Omit<MutMessage, "deliveredTo" | "lockedBy"> & {
      deliveredTo: string[];
      lockedBy: string | null;
    }
  >;
  writes: Array<[string, unknown]>;
}

/** Consumer registration. */
interface Consumer {
  signal: string;
  subscriberId: string;
  handler: SignalHandler;
}

/**
 * Create the shared in-process engine behind memory / outbox relay.
 *
 * @param driverId - Protocol id reported on the bus
 * @param options - Open options
 */
export async function createSignalEngine(
  driverId: SignalDriverId,
  options: SignalOpenOptions,
): Promise<SignalBus & { readonly onCommitted: Set<() => void> }> {
  const now = options.now ?? (() => Date.now());
  const signals = options.signals;
  const durablePath = options.durablePath;

  let messages: MutMessage[] = [];
  let writes = new Map<string, unknown>();
  const consumers: Consumer[] = [];
  const liveHandlers = new Map<string, Set<LiveHandler>>();
  const onCommitted = new Set<() => void>();
  let closed = false;

  if (durablePath) {
    const snap = await loadSnapshot(durablePath);
    if (snap) {
      messages = snap.messages.map((m) => ({
        ...m,
        lockedBy: m.lockedBy,
        deliveredTo: new Set(m.deliveredTo),
      }));
      writes = new Map(snap.writes);
    }
  }

  async function persist(): Promise<void> {
    if (!durablePath) return;
    const snap: Snapshot = {
      messages: messages.map((m) => ({
        id: m.id,
        signal: m.signal,
        payload: m.payload,
        delivery: m.delivery,
        attempts: m.attempts,
        failures: m.failures,
        createdAt: m.createdAt,
        availableAt: m.availableAt,
        status: m.status,
        lockedBy: m.lockedBy,
        deliveredTo: [...m.deliveredTo],
      })),
      writes: [...writes.entries()],
    };
    await mkdir(dirname(durablePath), { recursive: true });
    await Bun.write(durablePath, JSON.stringify(snap));
  }

  function requireDecl(name: string): SignalDecl {
    const decl = signals.get(name);
    if (!decl) {
      throw new Error(`Unknown signal: ${name}`);
    }
    return decl;
  }

  function stageEmit(
    stagedMessages: MutMessage[],
    name: string,
    payload: unknown,
  ): void {
    const decl = requireDecl(name);
    const t = now();
    stagedMessages.push({
      id: crypto.randomUUID(),
      signal: name,
      payload: payload ?? null,
      delivery: decl.delivery,
      attempts: 0,
      failures: [],
      createdAt: t,
      availableAt: t,
      status: "pending",
      lockedBy: null,
      deliveredTo: new Set(),
    });
  }

  function begin(): Promise<SignalTransaction> {
    if (closed) throw new Error("signal bus closed");
    const stagedMessages: MutMessage[] = [];
    const stagedWrites = new Map<string, unknown>();
    let done = false;

    const tx: SignalTransaction = {
      async write(key, value) {
        if (done) throw new Error("transaction finished");
        stagedWrites.set(key, value);
      },
      async emit(signal, payload) {
        if (done) throw new Error("transaction finished");
        stageEmit(stagedMessages, signal, payload);
      },
      async commit() {
        if (done) throw new Error("transaction finished");
        done = true;
        for (const [k, v] of stagedWrites) writes.set(k, v);
        messages.push(...stagedMessages);
        await persist();
        for (const hook of onCommitted) hook();
      },
      async rollback() {
        if (done) throw new Error("transaction finished");
        done = true;
        stagedMessages.length = 0;
        stagedWrites.clear();
      },
    };
    return Promise.resolve(tx);
  }

  async function emit(signal: string, payload?: unknown): Promise<void> {
    const tx = await begin();
    await tx.emit(signal, payload);
    await tx.commit();
  }

  async function subscribe(
    signal: string,
    subscriberId: string,
    handler: SignalHandler,
  ): Promise<SignalUnsubscribe> {
    requireDecl(signal);
    const entry: Consumer = { signal, subscriberId, handler };
    consumers.push(entry);
    return () => {
      const i = consumers.indexOf(entry);
      if (i >= 0) consumers.splice(i, 1);
    };
  }

  async function live(
    signal: string,
    handler: LiveHandler,
  ): Promise<SignalUnsubscribe> {
    const decl = requireDecl(signal);
    if (decl.delivery !== "live") {
      throw new Error(`signal "${signal}" is not delivery: "live"`);
    }
    let set = liveHandlers.get(signal);
    if (!set) {
      set = new Set();
      liveHandlers.set(signal, set);
    }
    set.add(handler);
    // Replay retained live messages to late subscribers.
    for (const m of messages) {
      if (m.signal === signal && m.delivery === "live") {
        await handler(m.payload);
      }
    }
    return () => {
      set!.delete(handler);
    };
  }

  function toPublic(m: MutMessage): SignalMessage {
    return {
      id: m.id,
      signal: m.signal,
      payload: m.payload,
      delivery: m.delivery,
      attempts: m.attempts,
      failures: [...m.failures],
      createdAt: m.createdAt,
      availableAt: m.availableAt,
      status: m.status,
    };
  }

  /**
   * Claim the next `once` message with SKIP LOCKED semantics.
   */
  function claimOnce(
    signal: string,
    consumerId: string,
  ): MutMessage | null {
    const t = now();
    for (const m of messages) {
      if (m.signal !== signal || m.delivery !== "once") continue;
      if (m.status !== "pending") continue;
      if (m.availableAt > t) continue;
      if (m.lockedBy !== null) continue;
      m.status = "inflight";
      m.lockedBy = consumerId;
      m.attempts += 1;
      return m;
    }
    return null;
  }

  async function deliverOnce(m: MutMessage, consumer: Consumer): Promise<void> {
    const decl = requireDecl(m.signal);
    try {
      await consumer.handler(toPublic(m));
      m.status = "delivered";
      m.lockedBy = null;
    } catch (err) {
      const reason: SignalFailureReason = {
        code: "handler_error",
        message: err instanceof Error ? err.message : String(err),
        at: now(),
        attempt: m.attempts,
      };
      m.failures.push(reason);
      m.lockedBy = null;
      if (m.attempts > decl.retries) {
        if (decl.deadLetter) {
          m.status = "dead";
        } else {
          m.status = "delivered";
        }
      } else {
        m.status = "pending";
        m.availableAt = now();
      }
    }
  }

  async function drainOnce(): Promise<boolean> {
    let progress = false;
    const onceConsumers = consumers.filter((c) => {
      const d = signals.get(c.signal);
      return d?.delivery === "once";
    });
    // Competing consumers: each claim is exclusive (SKIP LOCKED).
    for (const consumer of onceConsumers) {
      const m = claimOnce(consumer.signal, consumer.subscriberId);
      if (!m) continue;
      progress = true;
      await deliverOnce(m, consumer);
    }
    return progress;
  }

  async function drainBroadcast(): Promise<boolean> {
    let progress = false;
    for (const m of messages) {
      if (m.delivery !== "broadcast" || m.status === "dead") continue;
      if (m.status === "delivered") continue;
      const subs = consumers.filter((c) => c.signal === m.signal);
      if (subs.length === 0) continue;
      for (const sub of subs) {
        if (m.deliveredTo.has(sub.subscriberId)) continue;
        progress = true;
        m.attempts += 1;
        try {
          await sub.handler(toPublic(m));
          m.deliveredTo.add(sub.subscriberId);
        } catch (err) {
          const reason: SignalFailureReason = {
            code: "handler_error",
            message: err instanceof Error ? err.message : String(err),
            at: now(),
            attempt: m.attempts,
          };
          m.failures.push(reason);
        }
      }
      if (
        subs.length > 0 &&
        subs.every((s) => m.deliveredTo.has(s.subscriberId))
      ) {
        m.status = "delivered";
      }
    }
    return progress;
  }

  async function drainLive(): Promise<boolean> {
    let progress = false;
    for (const m of messages) {
      if (m.delivery !== "live" || m.status !== "pending") continue;
      const handlers = liveHandlers.get(m.signal);
      if (handlers && handlers.size > 0) {
        for (const h of handlers) {
          await h(m.payload);
        }
      }
      m.status = "delivered";
      progress = true;
    }
    return progress;
  }

  async function drain(): Promise<void> {
    for (let i = 0; i < 1000; i++) {
      const a = await drainOnce();
      const b = await drainBroadcast();
      const c = await drainLive();
      if (!a && !b && !c) break;
    }
    await persist();
  }

  async function deadLetters(signal: string): Promise<readonly DeadLetter[]> {
    return messages
      .filter((m) => m.signal === signal && m.status === "dead")
      .map((m) => ({ ...toPublic(m), status: "dead" as const }));
  }

  async function getWrite(key: string): Promise<unknown> {
    return writes.get(key);
  }

  async function close(): Promise<void> {
    closed = true;
    consumers.length = 0;
    liveHandlers.clear();
    onCommitted.clear();
  }

  return {
    driverId,
    onCommitted,
    emit,
    begin,
    subscribe,
    live,
    drain,
    deadLetters,
    getWrite,
    close,
  };
}

async function loadSnapshot(path: string): Promise<Snapshot | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const text = await file.text();
  if (!text.trim()) return null;
  return JSON.parse(text) as Snapshot;
}
