/**
 * Session token bag — memory / Storage persist with subscribe.
 *
 * @module
 */

/** Tokens written into a session store. */
export interface SessionTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt?: number;
  readonly userId?: string;
  readonly scopes?: readonly string[];
  readonly tenantId?: string | null;
}

/** Snapshot of identity for UI (from `auth.me` / sign-in). */
export interface SessionUser {
  readonly userId: string;
  readonly email?: string;
  readonly name?: string;
  readonly emailVerified?: boolean;
  readonly scopes: readonly string[];
  readonly tenantId: string | null;
  readonly apiKeyId: string | null;
  readonly sessionFresh?: boolean;
}

/** Listener notified on session mutations. */
export type SessionListener = () => void;

/** In-memory / persisted session token bag for Bearer `createClient` wiring. */
export interface MemorySession {
  accessToken: string | null;
  refreshToken: string | null;
  accessExpiresAt: number | null;
  userId: string | null;
  scopes: readonly string[];
  tenantId: string | null;
  user: SessionUser | null;
  set(tokens: SessionTokens): void;
  setUser(user: SessionUser | null): void;
  clear(): void;
  /** Wire into `createClient` `auth.getToken`. */
  getToken(): string | null;
  /** Subscribe to mutations; returns unsubscribe. */
  subscribe(listener: SessionListener): () => void;
  /**
   * Wire into `createClient` `auth.refresh` — calls the refresh Flow via the client.
   *
   * @param api - Client with `auth.refresh` route
   */
  refresh(api: {
    auth: {
      refresh: (input: { refreshToken: string }) => Promise<{
        data: {
          accessToken: string;
          refreshToken: string;
          accessExpiresAt?: number;
          userId?: string;
        } | null;
        error: unknown;
      }>;
    };
  }): Promise<string | null>;
}

/** Options for {@link memorySession} / {@link persistSession}. */
export interface MemorySessionOptions {
  /**
   * Web Storage backend. Prefer `sessionStorage` over `localStorage`
   * (XSS can still steal; `localStorage` survives tabs — explicit opt-in only).
   */
  readonly storage?: Storage;
  /** Storage key (default `oke.session`). */
  readonly key?: string;
}

const DEFAULT_KEY = "oke.session";

interface StoredBag {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: number | null;
  readonly userId: string | null;
  readonly scopes: readonly string[];
  readonly tenantId: string | null;
  readonly user: SessionUser | null;
}

/**
 * Create an in-memory session helper for Bearer `createClient` wiring.
 *
 * @param options - Optional Storage persist (memory when omitted)
 */
export function memorySession(options?: MemorySessionOptions): MemorySession {
  const storage = options?.storage;
  const key = options?.key ?? DEFAULT_KEY;
  const listeners = new Set<SessionListener>();

  const state: {
    accessToken: string | null;
    refreshToken: string | null;
    accessExpiresAt: number | null;
    userId: string | null;
    scopes: readonly string[];
    tenantId: string | null;
    user: SessionUser | null;
  } = {
    accessToken: null,
    refreshToken: null,
    accessExpiresAt: null,
    userId: null,
    scopes: [],
    tenantId: null,
    user: null,
  };

  if (storage) {
    try {
      const raw = storage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredBag;
        state.accessToken = parsed.accessToken ?? null;
        state.refreshToken = parsed.refreshToken ?? null;
        state.accessExpiresAt = parsed.accessExpiresAt ?? null;
        state.userId = parsed.userId ?? null;
        state.scopes = parsed.scopes ?? [];
        state.tenantId = parsed.tenantId ?? null;
        state.user = parsed.user ?? null;
      }
    } catch {
      /* ignore corrupt storage */
    }
  }

  function persist(): void {
    if (!storage) return;
    if (!state.accessToken || !state.refreshToken) {
      storage.removeItem(key);
      return;
    }
    const bag: StoredBag = {
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      accessExpiresAt: state.accessExpiresAt,
      userId: state.userId,
      scopes: state.scopes,
      tenantId: state.tenantId,
      user: state.user,
    };
    storage.setItem(key, JSON.stringify(bag));
  }

  function notify(): void {
    for (const l of listeners) l();
  }

  return {
    get accessToken() {
      return state.accessToken;
    },
    set accessToken(v) {
      state.accessToken = v;
      persist();
      notify();
    },
    get refreshToken() {
      return state.refreshToken;
    },
    set refreshToken(v) {
      state.refreshToken = v;
      persist();
      notify();
    },
    get accessExpiresAt() {
      return state.accessExpiresAt;
    },
    set accessExpiresAt(v) {
      state.accessExpiresAt = v;
      persist();
      notify();
    },
    get userId() {
      return state.userId;
    },
    set userId(v) {
      state.userId = v;
      persist();
      notify();
    },
    get scopes() {
      return state.scopes;
    },
    set scopes(v) {
      state.scopes = v;
      persist();
      notify();
    },
    get tenantId() {
      return state.tenantId;
    },
    set tenantId(v) {
      state.tenantId = v;
      persist();
      notify();
    },
    get user() {
      return state.user;
    },
    set(tokens) {
      state.accessToken = tokens.accessToken;
      state.refreshToken = tokens.refreshToken;
      state.accessExpiresAt = tokens.accessExpiresAt ?? null;
      state.userId = tokens.userId ?? null;
      if (tokens.scopes) state.scopes = tokens.scopes;
      if (tokens.tenantId !== undefined) state.tenantId = tokens.tenantId;
      persist();
      notify();
    },
    setUser(user) {
      state.user = user;
      if (user) {
        state.userId = user.userId;
        state.scopes = user.scopes;
        state.tenantId = user.tenantId;
      }
      persist();
      notify();
    },
    clear() {
      state.accessToken = null;
      state.refreshToken = null;
      state.accessExpiresAt = null;
      state.userId = null;
      state.scopes = [];
      state.tenantId = null;
      state.user = null;
      persist();
      notify();
    },
    getToken() {
      return state.accessToken;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async refresh(api) {
      if (!state.refreshToken) return null;
      const { data, error } = await api.auth.refresh({ refreshToken: state.refreshToken });
      if (error || !data) {
        state.accessToken = null;
        persist();
        notify();
        return null;
      }
      state.accessToken = data.accessToken;
      state.refreshToken = data.refreshToken;
      state.accessExpiresAt = data.accessExpiresAt ?? null;
      if (data.userId) state.userId = data.userId;
      persist();
      notify();
      return data.accessToken;
    },
  };
}

/**
 * Bearer session persisted to Storage.
 *
 * **Security:** XSS can read Storage. Prefer cookie mode or memory.
 * Use `sessionStorage` before `localStorage`; `localStorage` is an explicit
 * multi-tab convenience tradeoff — never the silent default.
 *
 * @param storage - `sessionStorage` or `localStorage`
 * @param key - Optional storage key
 */
export function persistSession(storage: Storage, key?: string): MemorySession {
  return memorySession({ storage, key });
}
