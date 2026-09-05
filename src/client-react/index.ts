/**
 * React helpers for okengine clients — `useSession` / `useLive` /
 * `useLiveQuery` over {@link createClient}.
 *
 * @module
 */

export {
  subscribeLiveResource,
  type ResourceStreamHandlers,
  type ResourceStreamOptions,
  type ResourceStreamStop,
} from "./live-resource.ts";
export type { LiveRouteContract } from "./use-live-query.ts";
export {
  useLiveQuery,
  type UseLiveQueryOptions,
  type UseLiveQueryState,
} from "./use-live-query.ts";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type {
  AuthClient,
  AuthorizeQuery,
  AuthorizeResult,
} from "../client/auth/create-auth-client.ts";
import type { MemorySession, SessionUser } from "../client/auth/session.ts";
import type { ClientLive, LiveInput, LiveSignalHandle } from "../client/types.ts";

/** Minimal client surface for session reading (legacy). */
export interface SessionClient {
  auth: {
    me: (input?: unknown) => Promise<{
      data: {
        userId: string;
        email: string;
        name: string;
        emailVerified?: boolean;
        scopes?: readonly string[];
        tenantId?: string | null;
        apiKeyId?: string | null;
        sessionFresh?: boolean;
      } | null;
      error: unknown;
    }>;
  };
}

/** Session snapshot returned by {@link useSession}. */
export interface SessionState {
  readonly status: "loading" | "authenticated" | "unauthenticated";
  readonly user: SessionUser | null;
  /** UI-only scopes from last `auth.me` — Gate on Flows is real authz. */
  readonly scopes: readonly string[];
  readonly accessToken: string | null;
  refresh(): Promise<void>;
  signOut(): void | Promise<void>;
  /** UI-only — never a security boundary. */
  hasScope(scope: string): boolean;
  can(...scopes: string[]): boolean;
}

/**
 * React hook over {@link AuthClient} (preferred) or legacy `api` + `memorySession`.
 *
 * @param apiOrAuth - AuthClient or typed client with `auth.me`
 * @param session - Optional memory session when using raw client
 */
export function useSession(apiOrAuth: AuthClient | SessionClient, session?: MemorySession): SessionState {
  const authClient = isAuthClient(apiOrAuth) ? apiOrAuth : null;
  const api = authClient ? null : (apiOrAuth as SessionClient);
  const bag = authClient?.session ?? session;

  const token = useSyncExternalStore(
    (onStoreChange) => {
      if (authClient) return authClient.subscribe(onStoreChange);
      if (!bag?.subscribe) {
        const id = setInterval(onStoreChange, 250);
        return () => clearInterval(id);
      }
      return bag.subscribe(onStoreChange);
    },
    () => bag?.accessToken ?? null,
    () => bag?.accessToken ?? null,
  );

  const [user, setUser] = useState<SessionUser | null>(authClient?.session.user ?? null);
  const [status, setStatus] = useState<SessionState["status"]>("loading");

  const refresh = useCallback(async () => {
    if (authClient) {
      setStatus("loading");
      const next = await authClient.getSession();
      setUser(next);
      setStatus(next ? "authenticated" : "unauthenticated");
      return;
    }
    if (!api) return;
    // Legacy SessionClient path — cookie sessions always use AuthClient above.
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
    const next: SessionUser = {
      userId: data.userId,
      email: data.email,
      name: data.name,
      emailVerified: data.emailVerified,
      scopes: data.scopes ?? [],
      tenantId: data.tenantId ?? null,
      apiKeyId: data.apiKeyId ?? null,
      ...(data.sessionFresh !== undefined ? { sessionFresh: data.sessionFresh } : {}),
    };
    bag?.setUser(next);
    setUser(next);
    setStatus("authenticated");
  }, [api, authClient, bag, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = useCallback(() => {
    if (authClient) return authClient.signOut();
    bag?.clear();
    setUser(null);
    setStatus("unauthenticated");
  }, [authClient, bag]);

  const scopes = user?.scopes ?? bag?.scopes ?? [];

  return {
    status,
    user,
    scopes,
    accessToken: token,
    refresh,
    signOut,
    hasScope: (scope: string) => scopes.includes(scope),
    can: (...needed: string[]) => {
      const have = new Set(scopes);
      return needed.every((s) => have.has(s));
    },
  };
}

function isAuthClient(value: unknown): value is AuthClient {
  return (
    value !== null &&
    typeof value === "object" &&
    "signIn" in value &&
    "getSession" in value &&
    "clientOptions" in value
  );
}

/**
 * UI-only scope check hook.
 *
 * @param auth - AuthClient or session state scopes
 * @param scope - Required scope
 */
export function useScope(auth: AuthClient | SessionState, scope: string): boolean {
  const scopes = useMemo(() => {
    if ("hasScope" in auth && typeof (auth as AuthClient).hasScope === "function" && "signIn" in auth) {
      return (auth as AuthClient).session.user?.scopes ?? (auth as AuthClient).session.scopes;
    }
    return (auth as SessionState).scopes;
  }, [auth]);
  return scopes.includes(scope);
}

/**
 * UI-only multi-scope check.
 *
 * @param auth - AuthClient or session state
 * @param scopes - Required scopes (all)
 */
export function useCan(auth: AuthClient | SessionState, ...scopes: string[]): boolean {
  const have = useMemo(() => {
    if ("can" in auth && "signIn" in auth) {
      return new Set(
        (auth as AuthClient).session.user?.scopes ?? (auth as AuthClient).session.scopes,
      );
    }
    return new Set((auth as SessionState).scopes);
  }, [auth]);
  return scopes.every((s) => have.has(s));
}

/**
 * UI-only authorize hook — prefers {@link AuthClient.authorize}.
 * Gate on Flows remains the security boundary.
 *
 * @param auth - AuthClient
 * @param query - all / any scopes
 */
export function useAuthorize(auth: AuthClient, query: AuthorizeQuery): AuthorizeResult {
  useSyncExternalStore(
    (onStoreChange) => auth.subscribe(onStoreChange),
    () => auth.session.user,
    () => auth.session.user,
  );
  // Re-read on every render after subscribe notifies.
  return auth.authorize(query);
}

/** Props for {@link Can} / {@link Cannot}. */
export interface CanProps {
  readonly auth: AuthClient;
  readonly all?: readonly string[];
  readonly any?: readonly string[];
  readonly children?: ReactNode;
  readonly fallback?: ReactNode;
  /** Rendered while authorize status is `loading` (default null). */
  readonly loading?: ReactNode;
}

function authorizeQueryOf(props: CanProps): AuthorizeQuery {
  if (props.all) return { all: props.all };
  if (props.any) return { any: props.any };
  return { all: [] };
}

/**
 * UI-only — render children when authorize status is `allowed`.
 * Not a security boundary.
 */
export function Can(props: CanProps): ReactNode {
  const query = authorizeQueryOf(props);
  const result = useAuthorize(props.auth, query);
  if (result.status === "loading") return props.loading ?? null;
  if (result.status === "allowed") return props.children ?? null;
  return props.fallback ?? null;
}

/**
 * UI-only — render children when authorize status is not `allowed`
 * (denied / unauthenticated). Loading uses `loading` prop.
 */
export function Cannot(props: CanProps): ReactNode {
  const query = authorizeQueryOf(props);
  const result = useAuthorize(props.auth, query);
  if (result.status === "loading") return props.loading ?? null;
  if (result.status === "allowed") return props.fallback ?? null;
  return props.children ?? null;
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
