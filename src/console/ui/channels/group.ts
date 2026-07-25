/**
 * Filter / group channel templates by query.
 */

import type { ChannelTemplate } from "./types.ts";

/**
 * Filter templates by name / medium / locale query.
 *
 * @param templates - Template rows
 * @param q - Free-text filter
 */
export function filterTemplates(
  templates: readonly ChannelTemplate[],
  q: string,
): readonly ChannelTemplate[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return templates;
  return templates.filter(
    (t) =>
      t.name.toLowerCase().includes(needle) ||
      t.medium.toLowerCase().includes(needle) ||
      t.locales.some((l) => l.toLowerCase().includes(needle)),
  );
}
