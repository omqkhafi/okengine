/**
 * Store panel pure modules (console §9.5).
 */

export type {
  StoreCacheView,
  StoreChild,
  StoreFacet,
  StoreFacetGroup,
  StoreListResponse,
  StoreRecord,
  WillNotFire,
} from "./types.ts";

export {
  parseStoreSearch,
  serializeStoreSearch,
  openStore,
  closeStore,
  openChild,
  type StoreSearch,
} from "./search.ts";

export { groupByFacet } from "./group.ts";
export {
  editConfirmation,
  deleteConfirmation,
  purgeConfirmation,
  validateTypedConfirm,
  UNDO_WINDOW_MS,
  type ConfirmationPattern,
} from "./confirmation.ts";
export { formatWillNotFire, type WillNotFireLines } from "./will-not-fire.ts";
export { previewOffer, type PreviewOffer } from "./dry-run.ts";
export { explainCache, type CacheExplanation } from "./cache-view.ts";
export { STORE_FIXTURE, STORE_LIST_FIXTURE, STORE_LIST_NO_TENANCY } from "./fixture.ts";
