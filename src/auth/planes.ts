/**
 * Two planes, permanently separated — operator vs user.
 *
 * Cross-plane invocation is a compile error. Principals never mix:
 * `fx.operator` on the Console plane, `fx.auth` on the application plane.
 *
 * @see docs/spec/console.md §2.2
 */

/** Auth plane identifiers. */
export type AuthPlane = "user" | "operator";

/** Brand so user and operator principals are not assignable. */
const planeBrand: unique symbol = Symbol("oke.plane");

/** User-plane principal (`fx.auth`). */
export interface UserPrincipal {
  readonly [planeBrand]: "user";
  readonly plane: "user";
  readonly userId: string;
  readonly scopes: ReadonlySet<string>;
  readonly verified: boolean;
  readonly roles: readonly string[];
}

/** Operator-plane principal (`fx.operator`). */
export interface OperatorPrincipal {
  readonly [planeBrand]: "operator";
  readonly plane: "operator";
  readonly id: string;
  readonly scopes: ReadonlySet<string>;
  readonly roles: readonly string[];
}

/** Any principal — discriminated by `plane`. */
export type Principal = UserPrincipal | OperatorPrincipal;

/**
 * Create a user-plane principal.
 *
 * @param fields - Identity fields
 */
export function userPrincipal(fields: {
  readonly userId: string;
  readonly scopes?: Iterable<string>;
  readonly verified?: boolean;
  readonly roles?: readonly string[];
}): UserPrincipal {
  return {
    [planeBrand]: "user",
    plane: "user",
    userId: fields.userId,
    scopes: new Set(fields.scopes ?? []),
    verified: fields.verified ?? false,
    roles: fields.roles ?? [],
  };
}

/**
 * Create an operator-plane principal.
 *
 * @param fields - Identity fields
 */
export function operatorPrincipal(fields: {
  readonly id: string;
  readonly scopes?: Iterable<string>;
  readonly roles?: readonly string[];
}): OperatorPrincipal {
  return {
    [planeBrand]: "operator",
    plane: "operator",
    id: fields.id,
    scopes: new Set(fields.scopes ?? []),
    roles: fields.roles ?? [],
  };
}

/**
 * Type-level / runtime guard: application principals cannot reach console flows.
 *
 * @param principal - Acting principal
 * @param flowPlane - Target flow plane
 */
export function assertPlaneAccess(
  principal: Principal,
  flowPlane: AuthPlane,
): void {
  if (principal.plane === "user" && flowPlane === "operator") {
    throw new CrossPlaneError(
      "application principal cannot reach a console (operator) flow",
    );
  }
}

/** Cross-plane invocation error (also raised at compile time). */
export class CrossPlaneError extends Error {
  /** @param message - Diagnostic */
  constructor(message: string) {
    super(message);
    this.name = "CrossPlaneError";
  }
}
