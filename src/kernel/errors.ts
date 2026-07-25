/**
 * Typed framework errors and flow-boundary failure values.
 *
 * Every framework error has a stable numeric code, a one-line cause,
 * a suggested fix, and a docs URL (unified-theory §21). Codes are
 * permanent from the moment they enter this registry.
 */

import { docsUrl as absoluteDocsUrl } from "../docs-origin.ts";

/** Numeric OKE error code (permanent once published). */
export type OkeErrorCode = number;

/** One registry entry — cause/fix may include `{name}` placeholders. */
export interface OkeErrorDefinition {
  /** Permanent numeric code. */
  readonly code: OkeErrorCode;
  /** One-line cause template. */
  readonly cause: string;
  /** Suggested fix template. */
  readonly fix: string;
}

/** Context values interpolated into cause/fix templates. */
export type OkeErrorParams = Readonly<Record<string, string>>;

/**
 * Framework error: thrown for invariant violations (capability, wiring).
 * Distinct from flow-boundary failures returned by {@link fail}.
 */
export class OkeError extends Error {
  /** Permanent numeric code. */
  readonly code: OkeErrorCode;
  /** Interpolated one-line cause. */
  readonly causeText: string;
  /** Interpolated suggested fix. */
  readonly fix: string;
  /** Docs URL for this code. */
  readonly docsUrl: string;
  /** Interpolation params used to build the message. */
  readonly params: OkeErrorParams;

  /**
   * @param definition - Registry entry
   * @param params - Values for `{placeholders}` in cause/fix
   */
  constructor(definition: OkeErrorDefinition, params: OkeErrorParams = {}) {
    const causeText = interpolate(definition.cause, params);
    const fix = interpolate(definition.fix, params);
    const docsUrl = absoluteDocsUrl(`/e/${definition.code}`);
    const message = formatOkeMessage(definition.code, causeText, fix, docsUrl);
    super(message);
    this.name = "OkeError";
    this.code = definition.code;
    this.causeText = causeText;
    this.fix = fix;
    this.docsUrl = docsUrl;
    this.params = params;
  }
}

/**
 * Flow-boundary failure value produced by {@link fail}.
 * Errors are values (`{ data, error }`), not exceptions, at the flow boundary.
 */
export interface FlowFailure<E = unknown> {
  readonly data: null;
  readonly error: FlowErrorValue<E>;
}

/** Payload carried by a flow-boundary failure. */
export interface FlowErrorValue<E = unknown> {
  /**
   * Declared error code from the flow's `errors` map
   * (e.g. `"FlightFull"`, `"ValidationError"`) — not an OKE#### number.
   * Clients narrow with `error?.code === "FlightFull"`.
   */
  readonly code: string;
  /** Typed error data from the flow. */
  readonly data: E;
  /** Optional localized or custom message. */
  readonly message?: string;
}

/** Optional extras for {@link fail}. */
export interface FailOptions {
  /** Override message (often from `fx.t(...)`). */
  readonly message?: string;
}

/**
 * Permanent error registry. Codes never change meaning once published.
 *
 * Ranges (convention):
 * - `1000–1099` — capability / undeclared-effect violations
 * - `1042` — reserved by unified-theory §21 example (orphan emit)
 */
export const OKE_ERRORS = {
  /** Flow reads a store resource not listed in `effects.reads`. */
  UNDECLARED_READ: {
    code: 1001,
    cause:
      'Flow "{flow}" reads "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.reads.',
  },
  /** Flow writes a store resource not listed in `effects.writes`. */
  UNDECLARED_WRITE: {
    code: 1002,
    cause:
      'Flow "{flow}" writes "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.writes.',
  },
  /** Flow emits a signal not listed in `effects.emits`. */
  UNDECLARED_EMIT: {
    code: 1003,
    cause:
      'Flow "{flow}" emits "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.emits.',
  },
  /** Flow sends a channel template not listed in `effects.sends`. */
  UNDECLARED_SEND: {
    code: 1004,
    cause:
      'Flow "{flow}" sends "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.sends.',
  },
  /** Flow asks a prompt not listed in `effects.asks`. */
  UNDECLARED_ASK: {
    code: 1005,
    cause:
      'Flow "{flow}" asks "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.asks.',
  },
  /** Flow reads a secret not listed in `effects.secrets`. */
  UNDECLARED_SECRET: {
    code: 1006,
    cause:
      'Flow "{flow}" reads secret "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.secrets.',
  },
  /** Flow calls another flow not listed in `effects.calls`. */
  UNDECLARED_CALL: {
    code: 1007,
    cause:
      'Flow "{flow}" calls "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.calls.',
  },
  /**
   * Emit target has no subscriber (unified-theory §21 example).
   * Reserved now so the number stays permanent.
   */
  ORPHAN_EMIT: {
    code: 1042,
    cause:
      'Flow "{flow}" emits signal "{resource}" with no subscriber.',
    fix: 'Add `on({resource}, …)` or mark the signal `{ optional: true }`.',
  },
} as const satisfies Record<string, OkeErrorDefinition>;

/**
 * Build and throw a registered framework error.
 *
 * @param key - Key into {@link OKE_ERRORS}
 * @param params - Interpolation params
 * @returns Never
 */
export function throwOke(
  key: keyof typeof OKE_ERRORS,
  params: OkeErrorParams = {},
): never {
  throw new OkeError(OKE_ERRORS[key], params);
}

/**
 * Look up a registry entry by numeric code.
 *
 * @param code - Permanent numeric code
 */
export function lookupOkeError(
  code: OkeErrorCode,
): OkeErrorDefinition | undefined {
  for (const def of Object.values(OKE_ERRORS)) {
    if (def.code === code) return def;
  }
  return undefined;
}

/**
 * Create a flow-boundary failure value (does not throw).
 *
 * @param code - Declared error code from the flow's `errors` map
 * @param data - Error payload
 * @param opts - Optional message override
 */
export function fail<E>(
  code: string,
  data: E,
  opts?: FailOptions,
): FlowFailure<E> {
  const error: FlowErrorValue<E> = opts?.message !== undefined
    ? { code, data, message: opts.message }
    : { code, data };
  return { data: null, error };
}

/**
 * Format the canonical multi-line OKE error message (§21).
 *
 * @param code - Numeric code
 * @param cause - Interpolated cause
 * @param fix - Interpolated fix
 * @param docsUrl - Docs URL
 */
export function formatOkeMessage(
  code: OkeErrorCode,
  cause: string,
  fix: string,
  docsUrl: string,
): string {
  return `OKE${code}  ${cause}\n         → ${fix}\n         ${docsUrl}`;
}

function interpolate(template: string, params: OkeErrorParams): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
    return params[key] ?? `{${key}}`;
  });
}
