/**
 * Typed search params for the Channels panel (console §7 · §9.9).
 */

import { z } from "zod";

const ChannelsSearchSchema = z.object({
  q: z.string().optional(),
  template: z.string().optional(),
  locale: z.string().optional(),
  view: z.enum(["inbox", "outcomes", "receipts", "suppression", "preview"]).optional(),
});

/** Parsed Channels URL search. */
export type ChannelsSearch = z.infer<typeof ChannelsSearchSchema>;

/**
 * Parse Channels panel search params.
 *
 * @param search - Raw router search
 */
export function parseChannelsSearch(search: Record<string, unknown>): ChannelsSearch {
  const parsed = ChannelsSearchSchema.safeParse(search);
  return parsed.success ? parsed.data : {};
}

/**
 * Serialize Channels search for navigation.
 *
 * @param search - Search state
 */
export function serializeChannelsSearch(search: ChannelsSearch): Record<string, string> {
  const out: Record<string, string> = {};
  if (search.q) out.q = search.q;
  if (search.template) out.template = search.template;
  if (search.locale) out.locale = search.locale;
  if (search.view) out.view = search.view;
  return out;
}

/**
 * Open a template in the URL.
 *
 * @param search - Current search
 * @param template - Template name
 */
export function openTemplate(search: ChannelsSearch, template: string): ChannelsSearch {
  return { ...search, template };
}
