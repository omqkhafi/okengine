/**
 * Console live channel — Manifest feed over WebSocket.
 *
 * Spec §5.1: code edit → oxc re-parses → Manifest → WebSocket → Console.
 * Also carries live run events for the Flow split-view Traces pane.
 */

import type { WideEvent } from "../../runs/types.ts";
import { projectRun } from "./flows.ts";
import { piiFieldNamesFromManifest } from "./runs-pii.ts";
import { isKeelManifest, refreshSeededIdentities, seedKeelAccessRoles } from "./dev-identities.ts";
import { publishLive, type ConsoleLiveMessage, type ConsoleState } from "./state.ts";

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
  refreshSeededIdentities(state.identities, manifest);
  if (isKeelManifest(manifest)) seedKeelAccessRoles(state.roles, state.roleMembers);
  publishLive(state, { type: "manifest", manifest });
  if (before) {
    publishLive(state, { type: "manifest.diff", before, after: manifest });
  }
}

/**
 * Push one recorded run to live subscribers (Flow split-view Traces).
 *
 * @param state - Console state
 * @param event - Wide event just recorded into the runs store
 */
export function feedRun(state: ConsoleState, event: WideEvent): void {
  if (state.liveSubscribers.size === 0) return;
  const piiFields = piiFieldNamesFromManifest(state.manifest);
  publishLive(state, { type: "run", run: projectRun(event, piiFields) });
}
