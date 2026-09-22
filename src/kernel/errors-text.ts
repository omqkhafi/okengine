/**
 * English cause/fix templates for {@link OKE_ERRORS}.
 *
 * Loaded on first read so the kernel edge profile does not carry the
 * strings. Localization still prefers the i18n catalogs when a locale
 * overrides `oke.{code}.cause` / `oke.{code}.fix`.
 */

/** One registry template pair. */
export interface OkeErrorText {
  /** One-line cause template. */
  readonly cause: string;
  /** Suggested fix template. */
  readonly fix: string;
}

/** Keyed by {@link OKE_ERRORS} property name. */
export const OKE_ERROR_TEXT: Readonly<Record<string, OkeErrorText>> = {
  UNDECLARED_READ: {
    cause: 'Flow "{flow}" reads "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.reads.',
  },
  UNDECLARED_WRITE: {
    cause: 'Flow "{flow}" writes "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.writes.',
  },
  UNDECLARED_EMIT: {
    cause: 'Flow "{flow}" emits "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.emits.',
  },
  UNDECLARED_SEND: {
    cause: 'Flow "{flow}" sends "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.sends.',
  },
  UNDECLARED_ASK: {
    cause: 'Flow "{flow}" asks "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.asks.',
  },
  UNDECLARED_SECRET: {
    cause: 'Flow "{flow}" reads secret "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.secrets.',
  },
  UNDECLARED_CALL: {
    cause: 'Flow "{flow}" calls "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.calls.',
  },
  UNDECLARED_FETCH: {
    cause: 'Flow "{flow}" fetches "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.fetches.',
  },
  UNDECLARED_EMBED: {
    cause: 'Flow "{flow}" embeds with "{resource}" without declaring it.',
    fix: 'Add "{resource}" to this flow\'s effects.embeds.',
  },
  NO_EFFECTS_DECLARED: {
    cause: 'Flow "{flow}" has no declared effects and no Manifest to derive them from.{extract}',
    fix:
      "Add explicit `effects` to this flow, or boot with a Manifest (`oke build`) / " +
      "`rootDir` so effects can be derived. If extract failed, ensure `oxc-parser` is " +
      "installed (okengine dependency). dev+compose/prod refuse an open capability token.",
  },
  ADOPT_BARREL_STALE: {
    cause: "src/flows/{unit} exists on disk but adopted no flows — the .adopt() barrel is stale.",
    fix: "Run `oke dev` or `oke build` to regenerate `src/flows/index.ts`.",
  },
  HTTP_PATH_UNRESOLVED: {
    cause: 'Flow "{flow}" bound {method} with no path — the file-tree stamp never ran.',
    fix: 'Put the file under `src/flows/<unit>/` and import `@/flows`, or pass an explicit path to `http.{method}("/…")`.',
  },
  HTTP_ROUTE_DUPLICATE: {
    cause: '{method} {path} is bound twice (flow "{flow}").',
    fix: "Give each HTTP flow a unique method + path.",
  },
  HTTP_FLOW_UNNAMED: {
    cause: "An HTTP flow on {method} {path} has no name.",
    fix: 'Use `flow("unit.export", {…})` or export it from a `src/flows/<unit>/` file so the tree can stamp `unit.export`.',
  },
  LIVE_EXPOSURE_DUPLICATE: {
    cause:
      'Live signal "{signal}" is exposed twice with the same gates ({gates}) and match ({match}).',
    fix: "Use a different gate or path-param filter, or drop the extra route.",
  },
  MCP_TOOL_DUPLICATE: {
    cause: 'MCP tool "{tool}" is bound twice (flow "{flow}").',
    fix: "Give each MCP tool exposure a unique tool name.",
  },
  ORPHAN_EMIT: {
    cause: 'Flow "{flow}" emits signal "{resource}" with no subscriber.',
    fix: "Add `on({resource}, …)` or mark the signal `{ optional: true }`.",
  },
  SIGNAL_SCHEMA: {
    cause: '"{resource}": {detail}',
    fix: "Fix schema payload.",
  },
  DOMAIN_SCHEMA_MISSING: {
    cause: "domain table not found — migrations have not been applied.",
    fix: "run `oke db migrate` against this environment.",
  },
};
