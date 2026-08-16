/**
 * Index Advisor enable mode — never CREATE when the engine does not list it.
 */

/** Advisor bits from `QUERY /console/store/sql/stats`. */
export type AdvisorAvailability = {
  readonly available: boolean;
  readonly installed: boolean;
};

/** What the performance toolbar should show. */
export type IndexAdvisorEnableMode = "on" | "enable" | "cta";

/**
 * Decide Enable vs honest CTA from `pg_available_extensions`.
 *
 * @param advisor - Stats payload advisor block
 */
export function indexAdvisorEnableMode(
  advisor: AdvisorAvailability | null | undefined,
): IndexAdvisorEnableMode | null {
  if (!advisor) return null;
  if (advisor.installed) return "on";
  if (advisor.available) return "enable";
  return "cta";
}
