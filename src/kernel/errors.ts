/**
 * Typed framework errors and flow-boundary failure values.
 *
 * Every framework error has a stable numeric code, a one-line cause,
 * a suggested fix, and a docs URL (unified-theory §21). Codes are
 * permanent from the moment they enter this registry.
 */

import { docsUrl as absoluteDocsUrl } from "../docs-origin.ts";
import { getActiveDefaultLocale, getActiveLocale } from "../i18n/locale-context.ts";
import { lazyRequire } from "./lazy-require.ts";

/** Catalogs — kept off the edge `fail` / `OKE_ERRORS` static graph. */
function loadMessages(): typeof import("../i18n/messages.ts") {
  const stem = ["mes", "sages"].join("");
  try {
    return lazyRequire(`${import.meta.dir}/../i18n`, stem);
  } catch {
    return lazyRequire(import.meta.dir, stem);
  }
}

/** Failure-message helper — same lazy boundary as {@link loadMessages}. */
function loadFailureMessage(): typeof import("../i18n/failure-message.ts") {
  const stem = ["failure", "message"].join("-");
  try {
    return lazyRequire(`${import.meta.dir}/../i18n`, stem);
  } catch {
    return lazyRequire(import.meta.dir, stem);
  }
}

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
   * @param locale - Optional locale (defaults to active request locale)
   */
  constructor(definition: OkeErrorDefinition, params: OkeErrorParams = {}, locale?: string) {
    const causeText = localizeOkePart(definition.code, "cause", definition.cause, params, locale);
    const fix = localizeOkePart(definition.code, "fix", definition.fix, params, locale);
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
    cause: 'Flow "{flow}" reads "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.reads.',
  },
  /** Flow writes a store resource not listed in `effects.writes`. */
  UNDECLARED_WRITE: {
    code: 1002,
    cause: 'Flow "{flow}" writes "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.writes.',
  },
  /** Flow emits a signal not listed in `effects.emits`. */
  UNDECLARED_EMIT: {
    code: 1003,
    cause: 'Flow "{flow}" emits "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.emits.',
  },
  /** Flow sends a channel template not listed in `effects.sends`. */
  UNDECLARED_SEND: {
    code: 1004,
    cause: 'Flow "{flow}" sends "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.sends.',
  },
  /** Flow asks a prompt not listed in `effects.asks`. */
  UNDECLARED_ASK: {
    code: 1005,
    cause: 'Flow "{flow}" asks "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.asks.',
  },
  /** Flow embeds via a model not listed in `effects.embeds`. */
  UNDECLARED_EMBED: {
    code: 1015,
    cause: 'Flow "{flow}" embeds with "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.embeds.',
  },
  /** Flow reads a secret not listed in `effects.secrets`. */
  UNDECLARED_SECRET: {
    code: 1006,
    cause: 'Flow "{flow}" reads secret "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.secrets.',
  },
  /** Flow calls another flow not listed in `effects.calls`. */
  UNDECLARED_CALL: {
    code: 1007,
    cause: 'Flow "{flow}" calls "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.calls.',
  },
  /**
   * Flow has no declared `effects` and no Manifest-derived effects were
   * available to stamp at boot (dev+compose / prod — never a silent open token).
   */
  NO_EFFECTS_DECLARED: {
    code: 1008,
    cause: 'Flow "{flow}" has no declared effects and no Manifest to derive them from.',
    fix:
      "Add explicit `effects` to this flow, or boot with a Manifest (`oke build`) / " +
      "`rootDir` so effects can be derived. dev+compose/prod refuse an open capability token.",
  },
  /**
   * A `src/flows/<unit>` folder exists on disk but no adopted flow carries
   * that unit — the generated `.adopt()` barrel (`src/flows/generated.ts`)
   * is stale or was hand-edited. dev+compose / prod — never a silently-incomplete
   * route table in a deploy-shaped environment.
   */
  ADOPT_BARREL_STALE: {
    code: 1009,
    cause: "src/flows/{unit} exists on disk but adopted no flows — the .adopt() barrel is stale.",
    fix: "Run `oke dev` or `oke build` to regenerate `src/flows/generated.ts`.",
  },
  /**
   * `http.get()` was never stamped from the file tree — refuse a silent `/`.
   */
  HTTP_PATH_UNRESOLVED: {
    code: 1010,
    cause: 'Flow "{flow}" bound {method} with no path — the file-tree stamp never ran.',
    fix: 'Put the file under `src/flows/<unit>/` and import `@/flows/generated`, or pass an explicit path to `http.{method}("/…")`.',
  },
  /**
   * Two HTTP bindings share method + path — last-add-wins is the opposite of this DX.
   */
  HTTP_ROUTE_DUPLICATE: {
    code: 1011,
    cause: '{method} {path} is bound twice (flow "{flow}").',
    fix: "Give each HTTP flow a unique method + path.",
  },
  /**
   * Adopted HTTP flow still has no name (`flow({ do })` outside a unit).
   */
  HTTP_FLOW_UNNAMED: {
    code: 1012,
    cause: "An HTTP flow on {method} {path} has no name.",
    fix: 'Use `flow("unit.export", {…})` or export it from a `src/flows/<unit>/` file so the tree can stamp `unit.export`.',
  },
  /**
   * Two live HTTP exposures of the same signal share gates + match shape.
   */
  LIVE_EXPOSURE_DUPLICATE: {
    code: 1013,
    cause:
      'Live signal "{signal}" is exposed twice with the same gates ({gates}) and match ({match}).',
    fix: "Use a different gate or path-param filter, or drop the extra route.",
  },
  /**
   * Two MCP tool bindings share the same exposed tool name.
   */
  MCP_TOOL_DUPLICATE: {
    code: 1018,
    cause: 'MCP tool "{tool}" is bound twice (flow "{flow}").',
    fix: "Give each MCP tool exposure a unique tool name.",
  },
  /**
   * Emit target has no subscriber (unified-theory §21).
   * Thrown at emit when `optional` is false and nobody is subscribed.
   */
  ORPHAN_EMIT: {
    code: 1042,
    cause: 'Flow "{flow}" emits signal "{resource}" with no subscriber.',
    fix: "Add `on({resource}, …)` or mark the signal `{ optional: true }`.",
  },
  /** Emit payload failed the signal's declared Standard Schema. */
  SIGNAL_SCHEMA: {
    code: 1043,
    cause: '"{resource}": {detail}',
    fix: "Fix schema payload.",
  },
  /**
   * Domain table/column missing under docker/prod (migrations not applied).
   * Store/DDL band starts at 1100.
   */
  DOMAIN_SCHEMA_MISSING: {
    code: 1101,
    cause: "domain table not found — migrations have not been applied.",
    fix: "run `oke db migrate` against this environment.",
  },
} as const satisfies Record<string, OkeErrorDefinition>;

/** Tenant error keys — definitions live in the lazy `errors-tenant` chunk. */
export type TenantOkeErrorKey = "TENANT_REQUIRED" | "TENANT_NOT_MEMBER" | "TENANT_UNKNOWN_SCOPE";

type TenantErrorChunk = {
  readonly TENANT_REQUIRED: OkeErrorDefinition;
  readonly TENANT_NOT_MEMBER: OkeErrorDefinition;
  readonly TENANT_UNKNOWN_SCOPE: OkeErrorDefinition;
};

/**
 * Load OKE1015–1017. Computed stem so Bun.build cannot inline the chunk.
 */
function loadTenantErrors(): TenantErrorChunk {
  return lazyRequire(import.meta.dir, ["errors", "tenant"].join("-"));
}

/**
 * Build and throw a registered framework error.
 *
 * @param key - Key into {@link OKE_ERRORS} or a lazy tenant code
 * @param params - Interpolation params
 * @returns Never
 */
export function throwOke(
  key: keyof typeof OKE_ERRORS | TenantOkeErrorKey,
  params: OkeErrorParams = {},
): never {
  if (typeof key === "string" && key.startsWith("TENANT_")) {
    throw new OkeError(loadTenantErrors()[key as TenantOkeErrorKey], params);
  }
  throw new OkeError(OKE_ERRORS[key as keyof typeof OKE_ERRORS], params);
}

/**
 * Look up a registry entry by numeric code.
 *
 * @param code - Permanent numeric code
 */
export function lookupOkeError(code: OkeErrorCode): OkeErrorDefinition | undefined {
  if (code === 1014) {
    return lazyRequire<typeof import("./errors-live-resume.ts")>(
      import.meta.dir,
      ["errors", "live", "resume"].join("-"),
    ).LIVE_RESUME_GAP;
  }
  if (code === 1015) return loadTenantErrors().TENANT_REQUIRED;
  if (code === 1016) return loadTenantErrors().TENANT_NOT_MEMBER;
  if (code === 1017) return loadTenantErrors().TENANT_UNKNOWN_SCOPE;
  for (const def of Object.values(OKE_ERRORS)) {
    if (def.code === code) return def;
  }
  return undefined;
}

/**
 * Create a flow-boundary failure value (does not throw).
 *
 * When `opts.message` is omitted, attaches a localized message from the
 * built-in / app catalogs (`errors.{code}.{reason}` → `errors.{code}`) using
 * the active request locale. Custom codes with no catalog entry stay
 * message-less.
 *
 * @param code - Declared error code from the flow's `errors` map
 * @param data - Error payload
 * @param opts - Optional message override
 */
export function fail<E>(code: string, data: E, opts?: FailOptions): FlowFailure<E> {
  const message =
    opts?.message !== undefined
      ? opts.message
      : loadFailureMessage().resolveFailureMessage(code, data);
  const error: FlowErrorValue<E> = message !== undefined ? { code, data, message } : { code, data };
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

/**
 * Localize one OKE cause/fix line from catalogs, falling back to the registry
 * English template.
 *
 * @param code - Numeric OKE code
 * @param part - `cause` or `fix`
 * @param fallback - Registry English template
 * @param params - Interpolation params
 * @param locale - Optional locale override
 */
function localizeOkePart(
  code: OkeErrorCode,
  part: "cause" | "fix",
  fallback: string,
  params: OkeErrorParams,
  locale?: string,
): string {
  const key = `oke.${code}.${part}`;
  const { getMessageCatalogs, translate } = loadMessages();
  const catalogs = getMessageCatalogs();
  const active = locale ?? getActiveLocale("en");
  const defaultLocale = getActiveDefaultLocale("en");
  if (catalogs[active]?.[key] === undefined && catalogs[defaultLocale]?.[key] === undefined) {
    return interpolate(fallback, params);
  }
  const formatted = translate({
    locale: active,
    defaultLocale,
    catalogs,
    key,
    values: params,
  });
  // Catalog returned uninterpolated ICU (missing args) → registry template.
  if (
    Object.keys(params).length === 0 ||
    formatted.includes("{flow}") ||
    formatted.includes("{resource}")
  ) {
    return interpolate(fallback, params);
  }
  return formatted;
}
