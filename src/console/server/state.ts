/**
 * Console server state — operators, sessions, claim code, Manifest snapshot.
 */

import {
  createOperatorStore,
  createSessionStore,
  type OperatorStore,
  type SessionStore,
} from "../../auth/index.ts";
import type { Manifest } from "../../manifest/types.ts";
import type { WideEvent } from "../../runs/types.ts";
import { mintClaimCode, type ClaimCodeState } from "./claim.ts";

/** Mutable Console runtime state for one process. */
export interface ConsoleState {
  readonly operators: OperatorStore;
  readonly sessions: SessionStore;
  readonly claim: ClaimCodeState;
  /** Auth HMAC secret (operator sessions). */
  readonly secret: string;
  /** Clock. */
  readonly now: () => number;
  /** Working-tree root for structural diffs. */
  readonly cwd: string;
  /** Latest Manifest snapshot fed to the live channel. */
  manifest: Manifest | null;
  /** Live-channel subscribers. */
  readonly liveSubscribers: Set<(msg: ConsoleLiveMessage) => void>;
  /** Bound after Console app boot — reads the runs store. */
  listRuns: () => Promise<WideEvent[]>;
  /** Whether first operator exists (wizard permanently closed). */
  get setupClosed(): boolean;
}

/** Live channel message kinds. */
export type ConsoleLiveMessage =
  | { readonly type: "manifest"; readonly manifest: Manifest }
  | {
      readonly type: "manifest.diff";
      readonly before: Manifest;
      readonly after: Manifest;
    }
  | { readonly type: "ping"; readonly at: number };

/** Options for {@link createConsoleState}. */
export interface CreateConsoleStateOptions {
  readonly secret?: string;
  readonly now?: () => number;
  readonly cwd?: string;
  readonly manifest?: Manifest | null;
  /** Skip printing the claim code (tests). */
  readonly silentClaim?: boolean;
}

/**
 * Create Console state and mint a claim code for this boot.
 *
 * @param options - Secret, clock, cwd
 */
export function createConsoleState(
  options: CreateConsoleStateOptions = {},
): ConsoleState {
  const secret =
    options.secret ??
    process.env.OKE_CONSOLE_SECRET ??
    `oke-console-dev-${crypto.randomUUID()}`;
  const now = options.now ?? (() => Date.now());
  const claim = mintClaimCode(now);
  const operators = createOperatorStore();
  const sessions = createSessionStore();
  const liveSubscribers = new Set<(msg: ConsoleLiveMessage) => void>();

  const state: ConsoleState = {
    operators,
    sessions,
    claim,
    secret,
    now,
    cwd: options.cwd ?? process.cwd(),
    manifest: options.manifest ?? null,
    liveSubscribers,
    listRuns: async () => [],
    get setupClosed() {
      return operators.operators.size > 0;
    },
  };

  return state;
}

/**
 * Publish a live message to all WebSocket / channel subscribers.
 *
 * @param state - Console state
 * @param message - Payload
 */
export function publishLive(
  state: ConsoleState,
  message: ConsoleLiveMessage,
): void {
  for (const sub of state.liveSubscribers) {
    try {
      sub(message);
    } catch {
      // Drop broken subscribers.
    }
  }
}

/**
 * Replace the Manifest snapshot and notify live subscribers.
 *
 * @param state - Console state
 * @param manifest - New Manifest
 */
export function setManifest(state: ConsoleState, manifest: Manifest): void {
  const before = state.manifest;
  state.manifest = manifest;
  publishLive(state, { type: "manifest", manifest });
  if (before) {
    publishLive(state, { type: "manifest.diff", before, after: manifest });
  }
}
