/**
 * React helpers for okengine clients — `useSession` over {@link createClient}.
 *
 * @module
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { MemorySession } from "../client/auth.ts";

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
