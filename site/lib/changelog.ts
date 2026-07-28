/**
 * Changelog source — parses the canonical `docs/changelog.md` at build time.
 *
 * The site renders release history; it does not invent it. Reading a committed
 * file rather than calling the GitHub releases API keeps the static export
 * deterministic and buildable with no network.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One `### <label>` block inside a release. */
export interface ChangelogGroup {
  readonly label: string;
  readonly items: ReadonlyArray<string>;
}

/** One published release. */
export interface ChangelogRelease {
  /** Bare version, e.g. `0.1.7`. */
  readonly version: string;
  /** Tag as written, e.g. `v0.1.7`. */
  readonly tag: string;
  /** ISO date as written, e.g. `2026-07-25`. */
  readonly date: string;
  /** Prose lines between the heading and the first group, if any. */
  readonly summary: ReadonlyArray<string>;
  readonly groups: ReadonlyArray<ChangelogGroup>;
}

/** `## v0.1.7 — 2026-07-25` — em dash or hyphen, either accepted. */
const RELEASE_HEADING = /^##\s+v(\d+\.\d+\.\d+[^\s]*)\s+[—-]\s+(\d{4}-\d{2}-\d{2})\s*$/;
const GROUP_HEADING = /^###\s+(.+?)\s*$/;
const BULLET = /^-\s+(.*)$/;

/** Repo-relative path to the canonical file. */
export const CHANGELOG_SOURCE = "docs/changelog.md";

/**
 * Parse the canonical changelog into releases.
 *
 * Continuation lines of a bullet (indented under it) are folded into that
 * bullet, so the markdown can wrap at 80 columns without splitting entries.
 *
 * @param raw - Full `docs/changelog.md` text
 * @throws If a bullet or prose line appears before any release heading
 */
export function parseChangelog(raw: string): ReadonlyArray<ChangelogRelease> {
  const releases: ChangelogRelease[] = [];
  let release: {
    version: string;
    tag: string;
    date: string;
    summary: string[];
    groups: { label: string; items: string[] }[];
  } | null = null;
  /** Set while a bullet is open, so wrapped lines append to it. */
  let openBullet: { items: string[] } | null = null;

  const commit = (): void => {
    if (release) releases.push(release);
    release = null;
    openBullet = null;
  };

  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    const heading = RELEASE_HEADING.exec(line);
    if (heading) {
      commit();
      release = {
        version: heading[1]!,
        tag: `v${heading[1]!}`,
        date: heading[2]!,
        summary: [],
        groups: [],
      };
      continue;
    }

    if (!release) continue;

    const group = GROUP_HEADING.exec(line);
    if (group) {
      const entry = { label: group[1]!, items: [] as string[] };
      release.groups.push(entry);
      openBullet = entry;
      continue;
    }

    const bullet = BULLET.exec(line.trim());
    if (bullet) {
      if (!openBullet) {
        throw new Error(`changelog: bullet outside a group in v${release.version}`);
      }
      openBullet.items.push(bullet[1]!);
      continue;
    }

    const text = line.trim();
    if (text.length === 0) continue;

    // Wrapped continuation of the previous bullet, else release summary prose.
    const current = openBullet?.items;
    if (current && current.length > 0) {
      current[current.length - 1] = `${current[current.length - 1]} ${text}`;
    } else if (release.groups.length === 0) {
      release.summary.push(text);
    }
  }

  commit();
  return releases;
}

/**
 * Read and parse the canonical changelog from the monorepo root.
 *
 * @throws If no release sections were found — an empty page is a defect, not an
 *   empty state
 */
export function loadChangelog(): ReadonlyArray<ChangelogRelease> {
  const raw = readFileSync(join(process.cwd(), "..", CHANGELOG_SOURCE), "utf8");
  const releases = parseChangelog(raw);
  if (releases.length === 0) {
    throw new Error(`changelog: no releases parsed from ${CHANGELOG_SOURCE}`);
  }
  return releases;
}

/** A run of plain text or a run of code, for inline rendering. */
export interface InlineSegment {
  readonly code: boolean;
  readonly text: string;
}

/**
 * Split a bullet into plain and `code` runs. Backticks are the only markdown we
 * support in changelog bullets, which keeps the renderer dependency-free.
 *
 * @param text - Bullet text
 */
export function splitInlineCode(text: string): ReadonlyArray<InlineSegment> {
  return text
    .split(/(`[^`]+`)/g)
    .filter((part) => part.length > 0)
    .map((part) =>
      part.startsWith("`") && part.endsWith("`") && part.length > 2
        ? { code: true, text: part.slice(1, -1) }
        : { code: false, text: part },
    );
}
