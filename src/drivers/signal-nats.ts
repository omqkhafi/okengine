/**
 * `nats` signal driver — throughput path with internal outbox relay.
 *
 * Emit enrols in a transactional outbox first; after commit a relay
 * publishes to NATS subjects. Queue groups implement `once`; plain
 * subjects implement `broadcast` / `live`.
 */

import { createSignalEngine } from "./signal-engine.ts";
import type {
  SignalBus,
  SignalDriver,
  SignalNatsClientLike,
  SignalOpenOptions,
} from "./signal-types.ts";

/**
 * In-memory NATS-protocol fake (subjects + queue groups).
 */
export function createSignalNatsFake(): SignalNatsClientLike & {
  readonly published: Array<{ subject: string; data: string }>;
} {
  type Sub = {
    queue?: string;
    callback: (data: Uint8Array) => void | Promise<void>;
  };
  const subs = new Map<string, Sub[]>();
  const published: Array<{ subject: string; data: string }> = [];
  let rr = 0;

  return {
    published,
    async publish(subject, data) {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      published.push({ subject, data: text });
      const list = subs.get(subject) ?? [];
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;

      const queued = list.filter((s) => s.queue);
      const plain = list.filter((s) => !s.queue);

      for (const s of plain) await s.callback(bytes);

      if (queued.length > 0) {
        // Queue group: exactly one subscriber receives the message.
        const pick = queued[rr++ % queued.length]!;
        await pick.callback(bytes);
      }
    },
    async subscribe(subject, opts) {
      let list = subs.get(subject);
      if (!list) {
        list = [];
        subs.set(subject, list);
      }
      const entry: Sub = { queue: opts.queue, callback: opts.callback };
      list.push(entry);
      return () => {
        const i = list!.indexOf(entry);
        if (i >= 0) list!.splice(i, 1);
      };
    },
  };
}

/**
 * Open a NATS signal bus (outbox + relay).
 *
 * @param options - Declarations / nats client / durable outbox path
 */
export async function openNatsSignal(options: SignalOpenOptions): Promise<SignalBus> {
  const nats = options.nats ?? createSignalNatsFake();
  const outbox = await createSignalEngine("nats", options);

  async function relayToNats(signal: string, payload: unknown): Promise<void> {
    const decl = options.signals.get(signal);
    if (!decl) return;
    const body = JSON.stringify(payload ?? null);
    if (decl.delivery === "once") {
      await nats.publish(`oke.signal.${signal}.once`, body);
    } else if (decl.delivery === "broadcast") {
      await nats.publish(`oke.signal.${signal}.broadcast`, body);
    } else {
      await nats.publish(`oke.signal.${signal}.live`, body);
    }
  }

  return {
    driverId: "nats",
    async emit(signal, payload, options) {
      await outbox.emit(signal, payload, options);
      await relayToNats(signal, payload);
    },
    async begin() {
      const staged: Array<{ signal: string; payload: unknown }> = [];
      const tx = await outbox.begin();
      return {
        write: (k, v) => tx.write(k, v),
        async emit(signal, payload, options) {
          staged.push({ signal, payload });
          await tx.emit(signal, payload, options);
        },
        async commit() {
          await tx.commit();
          for (const e of staged) await relayToNats(e.signal, e.payload);
        },
        rollback: () => tx.rollback(),
      };
    },
    subscribe: (signal, subscriberId, handler) => outbox.subscribe(signal, subscriberId, handler),
    live: (signal) => outbox.live(signal),
    drain: () => outbox.drain(),
    deadLetters: (s) => outbox.deadLetters(s),
    inspect: (s) => outbox.inspect(s),
    replay: (opts) => outbox.replay(opts),
    discard: (opts) => outbox.discard(opts),
    getWrite: (k) => outbox.getWrite(k),
    close: () => outbox.close(),
  };
}

/** Protocol-named nats signal driver. */
export const natsSignalDriver: SignalDriver = {
  id: "nats",
  open: openNatsSignal,
};
