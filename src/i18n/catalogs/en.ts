/**
 * Built-in English messages — framework OKE codes + typed failure messages.
 */

export const builtinEn = {
  oke: {
    "1001": {
      cause: 'Flow "{flow}" reads "{resource}" without declaring it.',
      fix: "Add \"{resource}\" to this flow''s effects.reads.",
    },
    "1002": {
      cause: 'Flow "{flow}" writes "{resource}" without declaring it.',
      fix: "Add \"{resource}\" to this flow''s effects.writes.",
    },
    "1003": {
      cause: 'Flow "{flow}" emits "{resource}" without declaring it.',
      fix: "Add \"{resource}\" to this flow''s effects.emits.",
    },
    "1004": {
      cause: 'Flow "{flow}" sends "{resource}" without declaring it.',
      fix: "Add \"{resource}\" to this flow''s effects.sends.",
    },
    "1005": {
      cause: 'Flow "{flow}" asks "{resource}" without declaring it.',
      fix: "Add \"{resource}\" to this flow''s effects.asks.",
    },
    "1006": {
      cause: 'Flow "{flow}" reads secret "{resource}" without declaring it.',
      fix: "Add \"{resource}\" to this flow''s effects.secrets.",
    },
    "1007": {
      cause: 'Flow "{flow}" calls "{resource}" without declaring it.',
      fix: "Add \"{resource}\" to this flow''s effects.calls.",
    },
    "1008": {
      cause: 'Flow "{flow}" fetches "{resource}" without declaring it.',
      fix: "Add \"{resource}\" to this flow''s effects.fetches.",
    },
    "1009": {
      cause: 'Flow "{flow}" embeds with "{resource}" without declaring it.',
      fix: "Add \"{resource}\" to this flow''s effects.embeds.",
    },
    "1240": {
      cause: 'Flow "{flow}" emits signal "{resource}" with no subscriber.',
      fix: "Add on({resource}, …) or mark the signal '{'optional: true'}'.",
    },
    "1210": {
      cause: 'Live cursor "{afterId}" is not on the tape for "{signal}".',
      fix: "Reconnect without Last-Event-ID to replay the remaining tape.",
    },
    "1810": {
      cause: "This operation needs a tenant, but none is resolved for this request.",
      fix: "Call fx.auth.switchTenant(id), send a signed tid claim, or pass the tenant header.",
    },
    "1820": {
      cause: 'The caller is not a member of tenant "{tenant}".',
      fix: "Pick a tenant from fx.auth.listTenants() or add the user as a member.",
    },
    "1830": {
      cause: 'Tenant role scope "{scope}" is not a declared application scope.',
      fix: "Use a name from this app's Manifest catalog (never console:*).",
    },
    "1110": {
      cause: "domain table not found — migrations have not been applied.",
      fix: "run `oke db migrate` against this environment.",
    },
    "1510": {
      cause: "{count} secrets have no value in any resolution layer.",
      fix: "Set each name (`oke vault set <name>`, or `.env.local`).",
    },
  },
  errors: {
    Unauthorized: "Authentication required.",
    Forbidden: "You are not allowed to perform this action.",
    RateLimited: "Too many requests. Try again later.",
    ValidationError: "The request failed validation.",
    NotFound: "The requested resource was not found.",
    Conflict: "That value is already in use.",
    ForeignKey: "That related record does not exist.",
    DatabaseError: "The database rejected this change.",
    "DatabaseError.not_null": "A required field is missing.",
    "DatabaseError.check": "A value did not meet a database check.",
    "DatabaseError.invalid": "A value is not valid for that column.",
    "DatabaseError.too_long": "A value is too long for that column.",
    "DatabaseError.out_of_range": "A value is outside the allowed range.",
    "DatabaseError.retryable": "The database is busy. Try again shortly.",
    ServiceUnavailable: "The service is temporarily unavailable.",
    InternalError: "Something went wrong. Try again.",
    IdempotencyKeyMissing: "This call requires an Idempotency-Key header.",
    IdempotencyKeyInvalid: "Idempotency-Key must be 16–255 printable ASCII characters.",
    IdempotencyKeyReused: "This Idempotency-Key was already used with a different request.",
    IdempotencyInProgress: "This Idempotency-Key is still running. Retry after the given delay.",
    InvalidQuery: "The query is not valid.",
    UnsupportedMediaType: "That content type is not supported.",
    AuthFailed: "Authentication failed.",
    AuthRateLimited: "Too many authentication attempts. Try again later.",
    "AuthFailed.invalid_credentials": "Invalid credentials.",
    "AuthFailed.invalid_refresh": "Refresh token is invalid or expired.",
    "AuthFailed.invalid_email": "Enter a valid email address.",
    "AuthFailed.invalid_phone": "Enter a valid phone number.",
    "AuthFailed.unauthenticated": "Sign in to continue.",
    "AuthFailed.password_breached":
      "Choose a different password — this one appears in a breach list.",
    "AuthFailed.username_policy": "That username does not meet the policy requirements.",
    "AuthFailed.password_policy": "That password does not meet the policy requirements.",
    "AuthFailed.invalid_origin": "Passkey origin was rejected.",
    "Forbidden.csrf": "Cross-site request blocked.",
    "Forbidden.invalid_key": "That object key is not allowed.",
    "Forbidden.ip_denied": "Your IP address is blocked.",
    "Forbidden.ip_not_allowed": "Your IP address is not allowed.",
    "Forbidden.policy_denied": "Policy denied this request.",
    "Forbidden.tenant_required": "This request needs a tenant.",
    "Forbidden.not_member": "You are not a member of that tenant.",
    "Forbidden.unknown_scope": "That tenant role scope is not a declared application scope.",
    "AuthRateLimited.rate_limited": "Too many authentication attempts. Try again later.",
  },
} as const;
