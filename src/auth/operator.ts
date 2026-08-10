/**
 * Operator plane — local credential always present; SSO is additive.
 *
 * The local password hash can never be removed. Enterprise SSO links a
 * provider as an *additional* authentication method.
 *
 * @see docs/spec/console.md §2.2–2.3
 */

import type { PasswordHashOptions } from "../runtime/types.ts";
import { createBunCrypto } from "../runtime/primitives.ts";
import { assertNotBreached, type BreachCheckFn } from "./breach-check.ts";
import { assertPasswordPolicy, type PasswordPolicyOptions } from "./password-policy.ts";
import type { OperatorCredentialRow, OperatorRow, OperatorSsoLinkRow } from "./tables.ts";

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
  /**
   * Password length / character-class policy. Defaults applied when omitted
   * (minLength 8, letter, number, upper, lower, symbol). Pass custom knobs to tighten/loosen
   * within reason — never skip without {@link skipPasswordPolicy}.
   */
  readonly passwordPolicy?: PasswordPolicyOptions;
  /**
   * Explicit opt-out of password policy (test harness only).
   * Production credential-set paths must omit this — same shape as
   * `unguardedHttp: "allow"` restricted to tests.
   */
  readonly skipPasswordPolicy?: boolean;
  /** Bun.password cost knobs (argon2id floor enforced). */
  readonly passwordHash?: PasswordHashOptions;
  /** Optional breach check (`true` = reject). */
  readonly breachCheck?: BreachCheckFn;
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
  if (!options.skipPasswordPolicy) {
    assertPasswordPolicy(options.password, options.passwordPolicy ?? {});
  }
  await assertNotBreached(options.password, options.breachCheck);
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
    passwordHash: await crypto.hashPassword(
      options.password,
      options.passwordHash ?? { algorithm: "argon2id" },
    ),
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
export function removeOperatorCredential(store: OperatorStore, operatorId: string): never {
  void store;
  void operatorId;
  throw new OperatorError("operator local credential cannot be removed; SSO is additive only");
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
    throw new OperatorError("operator is missing local credential — invariant violated");
  }
  const link: OperatorSsoLinkRow = { operatorId, provider, subject };
  const list = store.ssoLinks.get(operatorId) ?? [];
  list.push(link);
  store.ssoLinks.set(operatorId, list);
  return link;
}

/**
 * Dummy argon2id hash used when no credential exists so missing-user and
 * bad-password paths both pay a verify round-trip (timing oracle defence).
 */
let dummyPasswordHash: string | null = null;

async function dummyHash(crypto: ReturnType<typeof createBunCrypto>): Promise<string> {
  if (dummyPasswordHash === null) {
    dummyPasswordHash = await crypto.hashPassword("oke-operator-timing-dummy", "argon2id");
  }
  return dummyPasswordHash;
}

/**
 * Verify local password login.
 *
 * Always runs a password verify (against a dummy hash when the account is
 * missing / disabled) so response time does not reveal account existence.
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
  const cred = op && op.status === "active" ? store.credentials.get(op.id) : undefined;
  const hash = cred && cred.loginEnabled ? cred.passwordHash : await dummyHash(crypto);
  const ok = await crypto.verifyPassword(password, hash);
  if (!ok || !op || !cred || !cred.loginEnabled || op.status !== "active") {
    return null;
  }
  return op;
}

/** Operator-plane error. */
export class OperatorError extends Error {
  /** @param message - Diagnostic */
  constructor(message: string) {
    super(message);
    this.name = "OperatorError";
  }
}
