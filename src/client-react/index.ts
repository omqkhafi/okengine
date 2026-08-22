/**
 * React helpers for okengine clients — `useSession` / `useLive` over {@link createClient}.
 *
 * @module
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { MemorySession } from "../client/auth.ts";
import type { ClientLive, LiveInput, LiveSignalHandle } from "../client/types.ts";

/** Minimal client surface for session reading. */
export interface SessionClient {
  auth: {
    me: (input?: unknown) => Promise<{
      data: {
        userId: string;
        email: string;
        name: string;
        emailVerified?: boolean;
      } | null;
      error: unknown;
    }>;
  };
}

/** Session snapshot returned by {@link useSession}. */
export interface SessionState {
  readonly status: "loading" | "authenticated" | "unauthenticated";
  readonly user: {
    readonly userId: string;
    readonly email: string;
    readonly name: string;
    readonly emailVerified?: boolean;
  } | null;
  readonly accessToken: string | null;
  refresh(): Promise<void>;
  signOut(): void;
}

/**
 * React hook: read session via `auth.me` + optional {@link memorySession} helper.
 *
 * @param api - Typed client from `createClient`
 * @param session - Optional memory session (Bearer storage)
 */
export function useSession(api: SessionClient, session?: MemorySession): SessionState {
  const token = useSyncExternalStore(
    (onStoreChange) => {
      if (!session) return () => {};
      const id = setInterval(onStoreChange, 250);
      return () => clearInterval(id);
    },
    () => session?.accessToken ?? null,
    () => session?.accessToken ?? null,
  );

  const [user, setUser] = useState<SessionState["user"]>(null);
  const [status, setStatus] = useState<SessionState["status"]>("loading");

  const refresh = useCallback(async () => {
    if (!token) {
      setUser(null);
      setStatus("unauthenticated");
      return;
    }
    setStatus("loading");
    const { data, error } = await api.auth.me({});
    if (error || !data) {
      setUser(null);
      setStatus("unauthenticated");
      return;
    }
    setUser(data);
    setStatus("authenticated");
  }, [api, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(() => {
    session?.clear();
    setUser(null);
    setStatus("unauthenticated");
  }, [session]);

  return {
    status,
    user,
    accessToken: token,
    refresh,
    signOut,
  };
}

/** Options for {@link useLive}. */
export interface UseLiveOptions {
  readonly autoResubscribe?: boolean;
  readonly via?: string;
}

/** Hook state from {@link useLive}. */
export interface LiveState<T> {
  readonly events: T[];
  readonly latest: T | null;
  readonly error: unknown;
  readonly isConnected: boolean;
}

/** Client surface that exposes `api.live`. */
export interface LiveClient {
  readonly live: ClientLive;
}

/**
 * Subscribe to a `delivery: "live"` signal for the component lifetime.
 *
 * Cleanup calls `stop()`. Changing `signal` / `input` / `via` resets `events`.
 *
 * @param api - Typed client from `createClient`
 * @param signal - Signal handle or name
 * @param input - Path / match fields
 * @param options - Resubscribe and `via`
 */
export function useLive<T>(
  api: LiveClient,
  signal: LiveSignalHandle<T> | string,
  input?: LiveInput<T>,
  options?: UseLiveOptions,
): LiveState<T> {
  const signalName = typeof signal === "string" ? signal : signal.name;
  const inputKey = JSON.stringify(input ?? null);
  const autoResubscribe = options?.autoResubscribe;
  const via = options?.via;

  const [events, setEvents] = useState<T[]>([]);
  const [latest, setLatest] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(undefined);
  const [isConnected, setConnected] = useState(false);

  useEffect(() => {
    setEvents([]);
    setLatest(null);
    setError(undefined);
    setConnected(false);
    let stopped = false;
    const handlers = {
      autoResubscribe,
      ...(via !== undefined ? { via } : {}),
      onOpen: () => {
        if (!stopped) setConnected(true);
      },
      onEvent: (event: T) => {
        if (stopped) return;
        setConnected(true);
        setEvents((prev) => [...prev, event]);
        setLatest(event);
      },
      onError: (err: unknown) => {
        if (stopped) return;
        setError(err);
        setConnected(false);
      },
    };
    const parsedInput = inputKey === "null" ? undefined : (JSON.parse(inputKey) as LiveInput<T>);
    const stop =
      parsedInput === undefined
        ? api.live(signalName, handlers)
        : api.live(signalName, parsedInput, handlers);
    return () => {
      stopped = true;
      stop();
    };
  }, [api, signalName, inputKey, autoResubscribe, via]);

  return { events, latest, error, isConnected };
}
