/**
 * Operator invitations — invite-only plane (console §2.2 · §9.14).
 */

import type { OperatorInviteRow } from "./tables.ts";

/** Default invitation TTL (7 days). */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** In-memory operator invite store. */
export interface OperatorInviteStore {
  invites: Map<string, OperatorInviteRow>;
}

/**
 * Create an empty invite store.
 */
export function createOperatorInviteStore(): OperatorInviteStore {
  return { invites: new Map() };
}

/** Options when creating an invitation. */
export interface CreateInviteOptions {
  readonly email: string;
  readonly invitedBy: string;
  readonly id?: string;
  readonly ttlMs?: number;
  readonly now?: () => number;
}

/**
 * Create a pending operator invitation.
 *
 * @param store - Invite store
 * @param options - Invite fields
 */
export function createOperatorInvite(
  store: OperatorInviteStore,
  options: CreateInviteOptions,
): OperatorInviteRow {
  const now = options.now ?? (() => Date.now());
  const t = now();
  const row: OperatorInviteRow = {
    id: options.id ?? crypto.randomUUID(),
    email: options.email,
    invitedBy: options.invitedBy,
    createdAt: t,
    expiresAt: t + (options.ttlMs ?? INVITE_TTL_MS),
    acceptedAt: null,
  };
  store.invites.set(row.id, row);
  return row;
}

/**
 * Whether an invite is expired and still unaccepted.
 *
 * @param row - Invite row
 * @param now - Clock
 */
export function isInviteExpired(
  row: OperatorInviteRow,
  now: () => number = () => Date.now(),
): boolean {
  return row.acceptedAt === null && row.expiresAt <= now();
}
