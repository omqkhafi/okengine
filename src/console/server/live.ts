/**
 * Console live channel — Manifest feed over WebSocket.
 *
 * Spec §5.1: code edit → oxc re-parses → Manifest → WebSocket → Console.
 */

import type { ConsoleLiveMessage, ConsoleState } from "./state.ts";
import { publishLive } from "./state.ts";

/** WebSocket data bag for Console live clients. */
export interface ConsoleLiveData {
  readonly kind: "console-live";
}

/**
 * Minimal Bun `ServerWebSocket` surface used by the Console live channel.
 *
 * Declared locally so the public graph does not bare-import `"bun"` (JSR
 * rejects that specifier; `bun:` is allowed, but there is no `bun:websocket`
 * type entry). `send` matches Bun's signature so handlers remain assignable
 * to `Bun.serve` websocket callbacks — not a public API change.
 */
export interface ConsoleServerWebSocket<T = undefined> {
  readonly data: T;
  send(data: string | ArrayBuffer | Uint8Array, compress?: boolean): number;
}

/**
 * Subscribe a push function to the live channel.
 *
 * @param state - Console state
 * @param push - Message handler
 * @returns Unsubscribe
 */
export function subscribeLive(
  state: ConsoleState,
  push: (msg: ConsoleLiveMessage) => void,
): () => void {
  state.liveSubscribers.add(push);
  return () => {
    state.liveSubscribers.delete(push);
  };
}

/**
 * Bun WebSocket handlers for `/console/live`.
 *
 * @param state - Console state
 */
export function createLiveWebsocket(state: ConsoleState): {
  readonly open: (ws: ConsoleServerWebSocket<ConsoleLiveData>) => void;
  readonly message: (ws: ConsoleServerWebSocket<ConsoleLiveData>, message: string | Buffer) => void;
  readonly close: (ws: ConsoleServerWebSocket<ConsoleLiveData>) => void;
} {
  const unsubs = new WeakMap<ConsoleServerWebSocket<ConsoleLiveData>, () => void>();

  return {
    open(ws) {
      const push = (msg: ConsoleLiveMessage) => {
        try {
          ws.send(JSON.stringify(msg));
        } catch {
          // closed
        }
      };
      unsubs.set(ws, subscribeLive(state, push));
      if (state.manifest) {
        push({ type: "manifest", manifest: state.manifest });
      }
    },
    message(ws, message) {
      const text = typeof message === "string" ? message : message.toString();
      if (text === "ping") {
        ws.send(JSON.stringify({ type: "ping", at: state.now() }));
      }
    },
    close(ws) {
      unsubs.get(ws)?.();
      unsubs.delete(ws);
    },
  };
}

/**
 * Push a Manifest snapshot (used by `oke dev` file watcher).
 *
 * @param state - Console state
 * @param manifest - Manifest
 */
export function feedManifest(
  state: ConsoleState,
  manifest: import("../../manifest/types.ts").Manifest,
): void {
  const before = state.manifest;
  state.manifest = manifest;
  publishLive(state, { type: "manifest", manifest });
  if (before) {
    publishLive(state, { type: "manifest.diff", before, after: manifest });
  }
}
