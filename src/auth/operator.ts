/**
 * Operator plane — local credential always present; SSO is additive.
 *
 * The local password hash can never be removed. Enterprise SSO links a
 * provider as an *additional* authentication method.
 *
 * @see docs/spec/console.md §2.2–2.3
 */

import { createBunCrypto } from "../runtime/primitives.ts";
import type {
  OperatorCredentialRow,
  OperatorRow,
  OperatorSsoLinkRow,
} from "./tables.ts";

/** Operator-plane store. */
export interface OperatorStore {
  operators: Map<string, OperatorRow>;
  credentials: Map<string, OperatorCredentialRow>;
  ssoLinks: Map<string, OperatorSsoLinkRow[]>;
  roles: Map<string, string[]>;
}

/**
 * Create an empty operator store.
 */
export function createOperatorStore(): OperatorStore {
  return {
    operators: new Map(),
    credentials: new Map(),
    ssoLinks: new Map(),
    roles: new Map(),
  };
}

/** Options for creating an operator. */
export interface CreateOperatorOptions {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly invitedBy?: string | null;
  readonly id?: string;
  readonly roles?: readonly string[];
}

/**
 * Create an operator with a mandatory local credential.
 *
 * @param store - Operator store
 * @param options - Identity + password
 */
export async function createOperator(
  store: OperatorStore,
  options: CreateOperatorOptions,
): Promise<OperatorRow> {
  const crypto = createBunCrypto();
  const id = options.id ?? crypto.randomUUID();
  const row: OperatorRow = {
    id,
    email: options.email,
    name: options.name,
    status: "active",
    mfaEnabled: false,
    invitedBy: options.invitedBy ?? null,
    lastSeenAt: null,
  };
  store.operators.set(id, row);
  store.credentials.set(id, {
    operatorId: id,
    passwordHash: await crypto.hashPassword(options.password, "argon2id"),
    loginEnabled: true,
  });
  store.ssoLinks.set(id, []);
  store.roles.set(id, [...(options.roles ?? [])]);
  return row;
}

/**
 * Refuse removal of the local credential — SSO never becomes the sole path.
 *
 * @param store - Operator store
 * @param operatorId - Operator id
 */
export function removeOperatorCredential(
  store: OperatorStore,
  operatorId: string,
): never {
  void store;
  void operatorId;
  throw new OperatorError(
    "operator local credential cannot be removed; SSO is additive only",
  );
}

/**
 * Link an SSO identity as an additional method (local credential remains).
 *
 * @param store - Operator store
 * @param operatorId - Operator id
 * @param provider - Provider id
 * @param subject - Provider subject
 */
export function linkOperatorSso(
  store: OperatorStore,
  operatorId: string,
  provider: string,
  subject: string,
): OperatorSsoLinkRow {
  if (!store.operators.has(operatorId)) {
    throw new OperatorError(`unknown operator: ${operatorId}`);
  }
  if (!store.credentials.has(operatorId)) {
    throw new OperatorError(
      "operator is missing local credential — invariant violated",
    );
  }
  const link: OperatorSsoLinkRow = { operatorId, provider, subject };
  const list = store.ssoLinks.get(operatorId) ?? [];
  list.push(link);
  store.ssoLinks.set(operatorId, list);
  return link;
}

/**
 * Verify local password login.
 *
 * @param store - Operator store
 * @param email - Email
 * @param password - Password
 */
export async function authenticateOperator(
  store: OperatorStore,
  email: string,
  password: string,
): Promise<OperatorRow | null> {
  const crypto = createBunCrypto();
  const op = [...store.operators.values()].find((o) => o.email === email);
  if (!op || op.status !== "active") return null;
  const cred = store.credentials.get(op.id);
  if (!cred || !cred.loginEnabled) return null;
  const ok = await crypto.verifyPassword(password, cred.passwordHash);
  return ok ? op : null;
}

/** Operator-plane error. */
export class OperatorError extends Error {
  /** @param message - Diagnostic */
  constructor(message: string) {
    super(message);
    this.name = "OperatorError";
  }
}
