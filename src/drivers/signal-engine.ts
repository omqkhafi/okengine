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
import {
  DryRunWriteIsolationError,
  setDryRunMessageId,
  withDryRun,
} from "../kernel/dry-run.ts";
import type {
  DeadLetter,
  LiveHandler,
  SignalBus,
  SignalDiscardOptions,
  SignalDriverId,
  SignalFailureReason,
  SignalHandler,
  SignalMessage,
  SignalOpenOptions,
  SignalReplayOptions,
  SignalReplayResult,
  SignalStats,
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
  /** Trailing delivery timestamps for throughput (ms). */
  const deliveredAt: number[] = [];
  /** Recent live payloads per signal (newest last, capped). */
  const recentLive = new Map<string, unknown[]>();
  /** Per-subscriber error counts (broadcast). */
  const subscriberErrors = new Map<string, number>();
  let closed = false;

  function noteDelivered(): void {
    const t = now();
    deliveredAt.push(t);
    while (deliveredAt.length > 0 && deliveredAt[0]! < t - 1_000) {
      deliveredAt.shift();
    }
  }

  function pushLive(signal: string, payload: unknown): void {
    let list = recentLive.get(signal);
    if (!list) {
      list = [];
      recentLive.set(signal, list);
    }
    list.push(payload);
    while (list.length > 50) list.shift();
  }

  function failureFromError(
    err: unknown,
    attempt: number,
  ): SignalFailureReason {
    const code =
      err &&
      typeof err === "object" &&
      "code" in err &&
      typeof (err as { code: unknown }).code === "string"
        ? (err as { code: string }).code
        : err instanceof Error && err.name !== "Error"
          ? err.name
          : "handler_error";
    return {
      code,
      message: err instanceof Error ? err.message : String(err),
      at: now(),
      attempt,
    };
  }

  function throughputPerSec(): number {
    const t = now();
    let n = 0;
    for (let i = deliveredAt.length - 1; i >= 0; i--) {
      if (deliveredAt[i]! < t - 1_000) break;
      n += 1;
    }
    return n;
  }

  function outboxLagMs(signalName: string): number | null {
    const t = now();
    let oldest: number | null = null;
    for (const m of messages) {
      if (m.signal !== signalName) continue;
      if (m.status !== "pending" && m.status !== "inflight") continue;
      if (oldest === null || m.createdAt < oldest) oldest = m.createdAt;
    }
    return oldest === null ? null : Math.max(0, t - oldest);
  }

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
      noteDelivered();
    } catch (err) {
      m.failures.push(failureFromError(err, m.attempts));
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
          noteDelivered();
        } catch (err) {
          m.failures.push(failureFromError(err, m.attempts));
          const key = `${m.signal}::${sub.subscriberId}`;
          subscriberErrors.set(key, (subscriberErrors.get(key) ?? 0) + 1);
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
      pushLive(m.signal, m.payload);
      m.status = "delivered";
      noteDelivered();
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

  function statsFor(name: string): SignalStats | null {
    const decl = signals.get(name);
    if (!decl) return null;
    let pending = 0;
    let inflight = 0;
    let dead = 0;
    let delivered = 0;
    const deadList: DeadLetter[] = [];
    for (const m of messages) {
      if (m.signal !== name) continue;
      if (m.status === "pending") pending += 1;
      else if (m.status === "inflight") inflight += 1;
      else if (m.status === "dead") {
        dead += 1;
        deadList.push({ ...toPublic(m), status: "dead" });
      } else if (m.status === "delivered") delivered += 1;
    }
    const subs = consumers.filter((c) => c.signal === name);
    const subscribers = subs.map((c) => {
      let lag = 0;
      for (const m of messages) {
        if (m.signal !== name || m.delivery !== "broadcast") continue;
        if (m.status === "dead" || m.status === "delivered") continue;
        if (!m.deliveredTo.has(c.subscriberId)) lag += 1;
      }
      return {
        id: c.subscriberId,
        lag,
        errorCount: subscriberErrors.get(`${name}::${c.subscriberId}`) ?? 0,
      };
    });
    return {
      signal: name,
      delivery: decl.delivery,
      pending,
      inflight,
      dead,
      delivered,
      retries: decl.retries,
      deadLetterEnabled: decl.deadLetter,
      outboxLagMs: outboxLagMs(name),
      subscribers,
      connections: liveHandlers.get(name)?.size ?? 0,
      throughputPerSec: throughputPerSec(),
      schema: decl.schema,
      recentLive: [...(recentLive.get(name) ?? [])],
      deadLetters: deadList,
    };
  }

  async function inspect(signal?: string): Promise<readonly SignalStats[]> {
    if (signal) {
      const one = statsFor(signal);
      return one ? [one] : [];
    }
    const out: SignalStats[] = [];
    for (const name of signals.keys()) {
      const s = statsFor(name);
      if (s) out.push(s);
    }
    return out;
  }

  async function replay(
    options: SignalReplayOptions,
  ): Promise<SignalReplayResult> {
    requireDecl(options.signal);
    const rate = Math.max(1, options.ratePerSec);
    const intervalMs = Math.floor(1_000 / rate);
    const ids =
      options.messageIds && options.messageIds.length > 0
        ? new Set(options.messageIds)
        : null;
    const targets = messages.filter(
      (m) =>
        m.signal === options.signal &&
        m.status === "dead" &&
        (ids === null || ids.has(m.id)),
    );
    const results: SignalReplayResult["results"][number][] = [];
    const wouldHaveFired: SignalReplayResult["wouldHaveFired"][number][] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      if (i > 0 && intervalMs > 0) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      const m = targets[i]!;
      // Never mutate stored payload during dry-run — override is view-only.
      if (
        !options.dryRun &&
        options.payloads &&
        options.payloads[m.id] !== undefined
      ) {
        m.payload = options.payloads[m.id];
      }

      const handlers = consumers.filter((c) => {
        if (c.signal !== m.signal) return false;
        if (options.subscriberId) return c.subscriberId === options.subscriberId;
        return true;
      });

      if (handlers.length === 0) {
        const err = {
          code: "no_consumer",
          message: "No consumer registered for replay",
        };
        results.push({ id: m.id, ok: false, error: err });
        failed += 1;
        continue;
      }

      let ok = true;
      let lastErr: { code: string; message: string } | undefined;
      for (const h of handlers) {
        try {
          const publicMsg = toPublic(m);
          const msg =
            options.payloads?.[m.id] !== undefined
              ? { ...publicMsg, payload: options.payloads[m.id] }
              : publicMsg;
          if (options.dryRun) {
            // Stub send/ask; stub-store writes roll back when withDryRun exits.
            const stubbed = await withDryRun(async () => {
              setDryRunMessageId(m.id);
              await h.handler(msg);
            });
            for (const w of stubbed.wouldHaveFired) {
              wouldHaveFired.push({
                kind: w.kind,
                resource: w.resource,
                messageId: w.messageId ?? m.id,
              });
            }
          } else {
            await h.handler(msg);
          }
        } catch (err) {
          if (options.dryRun && err instanceof DryRunWriteIsolationError) {
            return {
              attempted: 0,
              succeeded: 0,
              failed: 0,
              dryRun: true,
              results: [],
              wouldHaveFired: [],
              refused: {
                code: "dry_run_unsafe",
                reason: err.message,
              },
            };
          }
          ok = false;
          const reason = failureFromError(err, m.attempts + 1);
          lastErr = { code: reason.code, message: reason.message };
          if (!options.dryRun) m.failures.push(reason);
        }
      }

      if (ok) {
        succeeded += 1;
        results.push({ id: m.id, ok: true });
        if (!options.dryRun) {
          m.status = "pending";
          m.lockedBy = null;
          m.availableAt = now();
          m.attempts = 0;
          if (m.delivery === "broadcast") {
            if (options.subscriberId) {
              // Re-target one subscriber — others keep their ack.
              m.deliveredTo.delete(options.subscriberId);
            } else {
              m.deliveredTo.clear();
            }
          }
        }
      } else {
        failed += 1;
        results.push({ id: m.id, ok: false, error: lastErr });
      }
    }

    if (!options.dryRun) await persist();
    return {
      attempted: targets.length,
      succeeded,
      failed,
      dryRun: options.dryRun,
      results,
      wouldHaveFired,
    };
  }

  async function discard(
    options: SignalDiscardOptions,
  ): Promise<{ readonly discarded: number }> {
    const ids = new Set(options.messageIds);
    let discarded = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (
        m.signal === options.signal &&
        m.status === "dead" &&
        ids.has(m.id)
      ) {
        messages.splice(i, 1);
        discarded += 1;
      }
    }
    await persist();
    return { discarded };
  }

  async function getWrite(key: string): Promise<unknown> {
    return writes.get(key);
  }

  async function close(): Promise<void> {
    closed = true;
    consumers.length = 0;
    liveHandlers.clear();
    onCommitted.clear();
    deliveredAt.length = 0;
    recentLive.clear();
    subscriberErrors.clear();
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
    inspect,
    replay,
    discard,
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
