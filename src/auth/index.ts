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
  resolveGateAuth,
  mintDevAuthSecret,
  normalizeBasePath,
  DEFAULT_FRESH_AGE_MS,
  type GateAuthOptions,
  type GateAuthSessionOptions,
  type EmailAndPasswordOptions,
  type AccountLinkingOptions,
  type AuthCookieOptions,
  type AuthSecondaryStorageOptions,
  type AuthDatabaseHooks,
  type ResolvedGateAuth,
  type ResolveGateAuthOptions,
} from "./config.ts";

export {
  resolveAuthSchema,
  authFieldSqlType,
  AUTH_MODEL_DEFAULT_FIELDS,
  AUTH_MODEL_DEFAULT_TABLES,
  type AuthCoreModel,
  type AuthFieldType,
  type AuthAdditionalField,
  type AuthModelOptions,
  type AuthSchemaOptions,
  type ResolvedAuthSchema,
  type ResolvedAuthModel,
  type ResolvedAuthColumn,
} from "./schema.ts";

export {
  createAuthHttpBindings,
  createAuthRateGates,
  createAuthPolicyGates,
  createFreshSessionGate,
  isSessionFresh,
  bindAuthHttp,
  AUTH_SESSION_GATE,
  AUTH_RATE_PRESETS,
  type AuthHttpMaterialization,
  type AuthRuntimeContext,
} from "./bindings.ts";

export {
  setActiveGateAuthContext,
  getActiveGateAuthContext,
  type ActiveGateAuthContext,
} from "./method-context.ts";

export { createAuthSecondaryStorage, type AuthKv } from "./secondary-storage.ts";

export {
  createVerificationStore,
  putVerification,
  findActiveVerification,
  consumeVerification,
  invalidateVerifications,
  wipeSealedOtp,
  hashChallenge,
  generateOtp,
  type VerificationStore,
  type VerificationRow,
  type OtpChannel,
} from "./verification.ts";

export { constantTimeEqual } from "./constant-time.ts";

export {
  createIdentityStore,
  createUserWithPassword,
  authenticateUser,
  getUserById,
  normalizeEmail,
  ensureUserByEmail,
  IdentityError,
  type IdentityStore,
  type UserIdentityRow,
  type UserAccountRow,
  type CreateUserWithPasswordOptions,
} from "./identity.ts";

export {
  authCookieNames,
  buildAuthSetCookies,
  clearAuthSetCookies,
  tokenFromCookieHeader,
  parseCookieHeader,
} from "./cookies.ts";

export {
  touchRateLimit,
  createLoginAttemptBag,
  AUTH_RATE_LIMIT,
  AUTH_RATE_WINDOW_MS,
  type LoginAttemptBag,
} from "./rate.ts";

export {
  assertPasswordPolicy,
  resolvePasswordPolicy,
  PasswordPolicyError,
  DEFAULT_PASSWORD_MIN_LENGTH,
  DEFAULT_PASSWORD_POLICY,
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
