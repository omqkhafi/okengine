/**
 * OAuth flow records on the shared verification store — PKCE verifier,
 * state, nonce, expected issuer, exact redirect URI and optional linking
 * subject, keyed `oauth:{provider}:{stateHash}` with SHA-256-hashed state at
 * rest (same hygiene as magic-link/OTP rows). Single-use via consume.
 */

import {
  createVerificationStore,
  findActiveVerification,
  consumeVerification,
  hashChallenge,
  putVerification,
  type VerificationStore,
} from "../../auth/verification.ts";
import type { OAuthProviderId } from "./shared.ts";

/** TTL for a pending OAuth authorization flow. */
export const OAUTH_FLOW_TTL_MS = 10 * 60_000;

/** One pending OAuth authorization-code flow. */
export interface OAuthFlowRecord {
  readonly provider: OAuthProviderId;
  /** SHA-256 hex of the raw state — the row's secret value. */
  readonly stateHash: string;
  readonly codeVerifier: string;
  /** EXACT redirect URI string registered at the provider. */
  readonly redirectUri: string;
  readonly nonce?: string;
  /** Issuer the flow was initiated against (mix-up anchor). */
  readonly expectedIssuer: string;
  /** Client id used to start the flow (aud check). */
  readonly clientId: string;
  /** Authenticated user linking this login to an existing account. */
  readonly currentUserId?: string;
}

/**
 * Create (or reuse) a verification store backing OAuth flows.
 *
 * @param existing - Shared store when the host app provides one
 */
export function createOAuthFlowStore(existing?: VerificationStore): VerificationStore {
  return existing ?? createVerificationStore();
}

/**
 * Persist a new flow record.
 *
 * @param store - Verification store
 * @param record - Flow fields
 * @param now - Epoch-ms
 */
export async function putOauthFlow(
  store: VerificationStore,
  record: OAuthFlowRecord,
  now: number,
): Promise<void> {
  putVerification(store, {
    id: `oauth:${record.provider}:${record.stateHash}`,
    identifier: `oauth:${record.provider}`,
    value: record.stateHash,
    expiresAt: now + OAUTH_FLOW_TTL_MS,
    createdAt: now,
    consumedAt: null,
    attempts: 0,
    // Flow fields ride the row's JSON slot (same pattern as channel-neutral OTP).
    email: JSON.stringify(record),
  });
}

/**
 * Find the active (non-consumed, non-expired) flow row for `(provider, rawState)`.
 *
 * @param store - Verification store
 * @param provider - Route provider id
 * @param rawState - Raw `state` query/form value
 * @param now - Epoch-ms
 */
export async function findOauthFlow(
  store: VerificationStore,
  provider: OAuthProviderId,
  rawState: string,
  now: number,
): Promise<OAuthFlowRecord | undefined> {
  const stateHash = await hashChallenge(rawState);
  for (const row of store.rows.values()) {
    if (row.identifier !== `oauth:${provider}`) continue;
    if (row.consumedAt !== null || row.expiresAt <= now) continue;
    if (row.value !== stateHash || row.email === undefined || row.email === null) continue;
    try {
      return JSON.parse(row.email) as OAuthFlowRecord;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Mark a flow row consumed (single-use — replay returns `invalid_state`).
 *
 * @param store - Verification store
 * @param provider - Route provider id
 * @param rawState - Raw state
 * @param now - Epoch-ms
 */
export async function consumeOauthFlow(
  store: VerificationStore,
  provider: OAuthProviderId,
  rawState: string,
  now: number,
): Promise<void> {
  const stateHash = await hashChallenge(rawState);
  const row = findActiveVerification(store, `oauth:${provider}`, now);
  if (row && row.value === stateHash) consumeVerification(row, now);
}
