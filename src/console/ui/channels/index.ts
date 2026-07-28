/**
 * Channels panel pure modules (console §9.9).
 */

export type {
  ChannelPreview,
  ChannelTemplate,
  ChannelsFace,
  ChannelsListResponse,
  DeliveryOutcomeState,
  DeliveryVerdict,
  EmailAuthView,
  FallbackMetric,
  InboxRow,
  OutcomeRow,
  ReceiptRow,
  SuppressionRow,
} from "./types.ts";

export {
  isConsequenceEmphasized,
  sortByConsequence,
  STATE_LABEL,
  VERDICT_LABEL,
} from "./taxonomy.ts";

export { spamComplaintFindings, type SpamComplaintFinding } from "./findings.ts";

export { formatFallbackLine } from "./fallback.ts";

export { dirForLocale, formatLocaleChainDisplay } from "./locale.ts";

export {
  sendTestConfirmation,
  UNDO_WINDOW_MS,
  validateTypedConfirm,
  type ConfirmationPattern,
} from "./confirmation.ts";

export { looksMasked } from "./mask.ts";

export {
  openTemplate,
  parseChannelsSearch,
  serializeChannelsSearch,
  type ChannelsSearch,
} from "./search.ts";

export { filterTemplates } from "./group.ts";

export { CHANNELS_INBOX_FIXTURE, CHANNELS_LIST_FIXTURE } from "./fixture.ts";
