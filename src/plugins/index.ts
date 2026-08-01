/**
 * Official plugins — first-party extensions built entirely on the public
 * plugin API (`okengine/plugins`). Import what you need; attach with
 * `.plug()`.
 */

export { anonymous, type AnonymousPluginOptions } from "./anonymous.ts";
export { compression, type CompressionOptions } from "./compression.ts";
export {
  configSource,
  isConfigSource,
  resolvePluginOptions,
  type ConfigSource,
  type ConfigSourceDb,
  type ConfigSourceOptions,
} from "./config-source.ts";
export { cors, type CorsOptions } from "./cors.ts";
export { csrf, type CsrfOptions } from "./csrf.ts";
export { emailOtp, emailOtpCatalog, emailOtpTemplate, type EmailOtpOptions } from "./email-otp.ts";
export { ipAllowlist, type IpAllowlistOptions } from "./ip-allowlist.ts";
export {
  magicLink,
  magicLinkCatalog,
  magicLinkTemplate,
  type MagicLinkOptions,
} from "./magic-link.ts";
export { maintenanceMode, type MaintenanceModeOptions } from "./maintenance-mode.ts";
export {
  createPasskeyStore,
  passkey,
  type PasskeyCredential,
  type PasskeyOptions,
  type PasskeyStore,
} from "./passkey.ts";
export {
  b64urlDecode,
  b64urlEncode,
  buildAuthenticatorData,
  signWebAuthnAssertion,
  verifyWebAuthnCeremony,
  type WebAuthnVerifyOptions,
} from "./passkey-webauthn.ts";
export {
  createPhoneStore,
  phoneNumber,
  type PhoneNumberOptions,
  type PhoneStore,
} from "./phone-number.ts";
export {
  defaultCspDirectives,
  headers,
  type CspOptions,
  type HeadersOptions,
  type HstsOptions,
} from "./headers.ts";
export {
  createTwoFactorStore,
  twoFactor,
  verifyTotp,
  type TwoFactorOptions,
  type TwoFactorRow,
  type TwoFactorStore,
} from "./two-factor.ts";
export {
  assertUsernamePolicy,
  createUsernameStore,
  DEFAULT_RESERVED_USERNAMES,
  DEFAULT_USERNAME_ALLOWED_CHARS,
  DEFAULT_USERNAME_MAX_LENGTH,
  DEFAULT_USERNAME_MIN_LENGTH,
  resolveUsernamePolicy,
  username,
  UsernamePolicyError,
  type ResolvedUsernamePolicy,
  type UsernamePluginOptions,
  type UsernamePolicyOptions,
  type UsernameRow,
  type UsernameStore,
} from "./username.ts";
