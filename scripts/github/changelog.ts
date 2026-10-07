/**
 * Changelog slices shared by the pull-request check and the tag release.
 */

const UNRELEASED = /^## Unreleased\s*$/m;

/**
 * Body under `## Unreleased`, up to the next `## ` heading.
 *
 * @param markdown - Full changelog
 */
export function unreleasedSection(markdown: string): string {
  const match = UNRELEASED.exec(markdown);
  if (match === null) return "";
  const rest = markdown.slice(match.index + match[0].length);
  const next = /\n## /.exec(rest);
  const body = next === null ? rest : rest.slice(0, next.index);
  return body.trim();
}

/**
 * True when the pull request adds or edits the Unreleased section.
 *
 * @param base - Changelog on the base ref
 * @param head - Changelog on the head ref
 */
export function unreleasedChanged(base: string, head: string): boolean {
  const before = unreleasedSection(base);
  const after = unreleasedSection(head);
  return after !== before && after.length > 0;
}

/**
 * The `## v<version>` section, including its heading.
 * Returns null when that version is not in the file.
 *
 * @param markdown - Full changelog
 * @param version - Version without the leading `v`
 */
export function changelogSection(markdown: string, version: string): string | null {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^## v${escaped}(?:\\s|$)`, "m");
  const match = heading.exec(markdown);
  if (match === null) return null;
  const rest = markdown.slice(match.index);
  const next = /\n## v/.exec(rest.slice(match[0].length));
  if (next === null) return rest.trim();
  return rest.slice(0, match[0].length + next.index).trim();
}

/**
 * Milestone titles to try for a tag version, exact name first, then the
 * `major.minor` release train.
 *
 * @param version - Version without the leading `v`
 */
/** Milestone titles that are not the version string. Tried after the version names. */
const MILESTONE_ALIASES: Readonly<Record<string, string>> = {
  "0.25": "OKModel replaces Drizzle (breaking)",
};

export function milestoneTitlesForVersion(version: string): readonly string[] {
  const parts = version.split(".");
  const major = parts[0];
  const minor = parts[1];
  if (major === undefined || minor === undefined) return [version];
  const train = `${major}.${minor}`;
  const alias = MILESTONE_ALIASES[train];
  const names = train === version ? [version] : [version, train];
  return alias === undefined ? names : [...names, alias];
}
