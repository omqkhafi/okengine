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
    "1042": {
      cause: 'Flow "{flow}" emits signal "{resource}" with no subscriber.',
      fix: "Add on({resource}, …) or mark the signal '{'optional: true'}'.",
    },
    "1101": {
      cause: "domain table not found — migrations have not been applied.",
      fix: "run `oke db migrate` against this environment.",
    },
  },
  errors: {
    Unauthorized: "Authentication required.",
    Forbidden: "You are not allowed to perform this action.",
    RateLimited: "Too many requests. Try again later.",
    ValidationError: "The request failed validation.",
    NotFound: "The requested resource was not found.",
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
    "Forbidden.ip_denied": "Your IP address is blocked.",
    "Forbidden.ip_not_allowed": "Your IP address is not allowed.",
    "Forbidden.policy_denied": "Policy denied this request.",
    "AuthRateLimited.rate_limited": "Too many authentication attempts. Try again later.",
  },
} as const;
