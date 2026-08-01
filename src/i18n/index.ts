/**
 * App i18n — ICU message catalogs for `fx.t`, typed keys, locale helpers.
 *
 * Channel locale resolution lives in `elements/channel/locale.ts`; this
 * module owns Flow-facing string catalogs registered via {@link defineLocale}.
 */

export { clearMessageFormatCache, formatMessage } from "./format.ts";

export {
  catalogReasonKey,
  failureMessageValues,
  isCatalogReason,
  resolveFailureMessage,
} from "./failure-message.ts";

export {
  getActiveDefaultLocale,
  getActiveLocale,
  getLocaleContext,
  runWithLocale,
  type LocaleContext,
} from "./locale-context.ts";

export {
  clearMessageCatalogs,
  defineLocale,
  defineMessages,
  flattenMessages,
  getMessageCatalogs,
  interpolateMessage,
  matchConfiguredLocale,
  translate,
  type MessageCatalog,
  type MessageCatalogs,
  type TranslateOptions,
} from "./messages.ts";

export type {
  AppMessageKey,
  FlattenKeys,
  MessageTree,
  MessageValue,
  MessageValues,
  MessagesFor,
  Register,
} from "./types.ts";

export {
  formatLocaleChain,
  isRtlLocale,
  parseAcceptLanguage,
  resolveLocale,
  type LocaleChainStep,
  type LocaleResolution,
  type ResolveLocaleOptions,
} from "../elements/channel/locale.ts";
