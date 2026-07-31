/**
 * Optional auth helpers for {@link createClient} — not a second client factory.
 *
 * @module
 */

/** Common auth Flow error codes (server `fail` codes). */
export const AUTH_ERROR_CODES = {
  AuthFailed: "AuthFailed",
  AuthRateLimited: "AuthRateLimited",
  Unauthorized: "Unauthorized",
  Forbidden: "Forbidden",
} as const;

/** In-memory session token bag for SPA / Node clients. */
export interface MemorySession {
  accessToken: string | null;
  refreshToken: string | null;
  accessExpiresAt: number | null;
  userId: string | null;
  set(tokens: {
    readonly accessToken: string;
    readonly refreshToken: string;
    readonly accessExpiresAt?: number;
    readonly userId?: string;
  }): void;
  clear(): void;
  /** Wire into `createClient` `auth.getToken`. */
  getToken(): string | null;
  /**
   * Wire into `createClient` `auth.refresh` — calls the refresh Flow via the client.
   *
   * @param api - Client with `auth.refresh` route (or custom path)
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

/**
 * Create an in-memory session helper for Bearer `createClient` wiring.
 */
export function memorySession(): MemorySession {
  const state: {
    accessToken: string | null;
    refreshToken: string | null;
    accessExpiresAt: number | null;
    userId: string | null;
  } = {
    accessToken: null,
    refreshToken: null,
    accessExpiresAt: null,
    userId: null,
  };

  return {
    get accessToken() {
      return state.accessToken;
    },
    set accessToken(v) {
      state.accessToken = v;
    },
    get refreshToken() {
      return state.refreshToken;
    },
    set refreshToken(v) {
      state.refreshToken = v;
    },
    get accessExpiresAt() {
      return state.accessExpiresAt;
    },
    set accessExpiresAt(v) {
      state.accessExpiresAt = v;
    },
    get userId() {
      return state.userId;
    },
    set userId(v) {
      state.userId = v;
    },
    set(tokens) {
      state.accessToken = tokens.accessToken;
      state.refreshToken = tokens.refreshToken;
      state.accessExpiresAt = tokens.accessExpiresAt ?? null;
      state.userId = tokens.userId ?? null;
    },
    clear() {
      state.accessToken = null;
      state.refreshToken = null;
      state.accessExpiresAt = null;
      state.userId = null;
    },
    getToken() {
      return state.accessToken;
    },
    async refresh(api) {
      if (!state.refreshToken) return null;
      const { data, error } = await api.auth.refresh({ refreshToken: state.refreshToken });
      if (error || !data) {
        state.accessToken = null;
        return null;
      }
      state.accessToken = data.accessToken;
      state.refreshToken = data.refreshToken;
      state.accessExpiresAt = data.accessExpiresAt ?? null;
      if (data.userId) state.userId = data.userId;
      return data.accessToken;
    },
  };
}
