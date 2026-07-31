/**
 * Auth: built-in flagship (hybrid JWT + revocable refresh, ABAC, MFA)
 * plus a provider seam. Subpath: `okengine/auth`.
 *
 * Two planes — `fx.operator` vs `fx.auth` — permanently separated.
 * @module
 */

export {
  auth,
  sessionCryptoFromAuthOptions,
  type AuthPluginOptions,
  type AuthSessionOptions,
} from "./plugin.ts";

export {
  assertPasswordPolicy,
  resolvePasswordPolicy,
  PasswordPolicyError,
  DEFAULT_PASSWORD_MIN_LENGTH,
  type PasswordPolicyOptions,
  type ResolvedPasswordPolicy,
} from "./password-policy.ts";

export {
  assertNotBreached,
  createHibpBreachCheck,
  sha1HexUpper,
  BreachCheckError,
  type BreachCheckFn,
  type BreachCheckErrorMode,
  type HibpBreachCheckOptions,
} from "./breach-check.ts";

export {
  assertPlaneAccess,
  operatorPrincipal,
  userPrincipal,
  CrossPlaneError,
  type AuthPlane,
  type OperatorPrincipal,
  type Principal,
  type UserPrincipal,
} from "./planes.ts";

export {
  assertCrossPlane,
  checkCrossPlane,
  type CrossPlaneDiagnostic,
  type PlaneSourceFile,
} from "./cross-plane.ts";

export {
  attenuateScopes,
  assertAttenuated,
  expandHeldScopes,
  grantableScopes,
  AttenuationError,
  type AttenuationResult,
} from "./attenuation.ts";

export {
  createApiKey,
  createApiKeyStore,
  authenticateApiKey,
  hashApiKeySecret,
  revokeApiKey,
  rotateApiKey,
  type ApiKeyStore,
  type CreateApiKeyOptions,
  type CreatedApiKey,
} from "./api-keys.ts";

export {
  createOperatorInviteStore,
  createOperatorInvite,
  isInviteExpired,
  INVITE_TTL_MS,
  type CreateInviteOptions,
  type OperatorInviteStore,
} from "./invites.ts";

export {
  createSessionStore,
  issueSession,
  issueSessionWithScopes,
  rotateRefresh,
  verifyAccess,
  revokeFamily,
  revokePrincipalSessions,
  bindSessionScopes,
  bindSessionAudience,
  ACCESS_TTL_MS,
  REFRESH_TTL_MS,
  SessionError,
  type AccessClaims,
  type IssuedSession,
  type SessionCrypto,
  type SessionStore,
  type VerifyAccessOptions,
} from "./sessions.ts";

export {
  createOperatorStore,
  createOperator,
  removeOperatorCredential,
  linkOperatorSso,
  authenticateOperator,
  OperatorError,
  type CreateOperatorOptions,
  type OperatorStore,
} from "./operator.ts";

export {
  createRoleStore,
  upsertRole,
  setRoleGrants,
  scopesForRoles,
  listRoleGrants,
  type RoleStore,
} from "./roles.ts";

export { invokeAs, type InvokeAsOptions } from "./invoke-as.ts";

export {
  AUTH_TABLES,
  type ApiKeyRow,
  type IdentityRow,
  type OperatorCredentialRow,
  type OperatorInviteRow,
  type OperatorRow,
  type OperatorSsoLinkRow,
  type RefreshTokenRow,
  type RoleGrantRow,
  type RoleRow,
  type SessionRow,
  type TablePlane,
} from "./tables.ts";
