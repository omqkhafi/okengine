/**
 * Changelog source — parses the canonical root `changelog.md` at build time.
 *
 * The site renders release history; it does not invent it. Reading a committed
 * file rather than calling the GitHub releases API keeps the build
 * deterministic and buildable with no network.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** One `### <label>` block inside a release. */
export interface ChangelogGroup {
  readonly label: string;
  readonly items: ReadonlyArray<string>;
  /** `####` area headings nested under this group. */
  readonly subgroups: ReadonlyArray<ChangelogGroup>;
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
/** Upcoming work — skipped by the site parser; `bun run bump` promotes it. */
const UNRELEASED_HEADING = /^##\s+Unreleased\s*$/;
const GROUP_HEADING = /^###\s+(.+?)\s*$/;
const SUBGROUP_HEADING = /^####\s+(.+?)\s*$/;
const BULLET = /^-\s+(.*)$/;

/** Repo-relative path to the canonical file. */
export const CHANGELOG_SOURCE = "changelog.md";

/**
 * Agent-readability budget used to gate rendered changelog pages.
 * Heuristic: `ceil(chars / 4)`, matching the scan that flagged the unsplit page.
 */
export const AGENT_READABILITY_TOKEN_BUDGET = 25_000;

/**
 * Parse the canonical changelog into releases.
 *
 * Continuation lines of a bullet (indented under it) are folded into that
 * bullet, so the markdown can wrap at 80 columns without splitting entries.
 * A leading `## Unreleased` section is ignored here — it is staging for the
 * next bump, not a published release. `####` area headings nest under the
 * current `###` group.
 *
 * @param raw - Full `changelog.md` text
 * @throws If a bullet or prose line appears before any release heading
 */
export function parseChangelog(raw: string): ReadonlyArray<ChangelogRelease> {
  const releases: ChangelogRelease[] = [];
  type MutableGroup = { label: string; items: string[]; subgroups: MutableGroup[] };
  let release: {
    version: string;
    tag: string;
    date: string;
    summary: string[];
    groups: MutableGroup[];
  } | null = null;
  /** Current `###` group — `####` headings nest under it. */
  let currentGroup: MutableGroup | null = null;
  /** Set while a bullet is open, so wrapped lines append to it. */
  let openBullet: { items: string[] } | null = null;
  /** True while skipping the upcoming-work section. */
  let skippingUnreleased = false;

  const commit = (): void => {
    if (release) releases.push(release);
    release = null;
    currentGroup = null;
    openBullet = null;
  };

  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    if (UNRELEASED_HEADING.test(line)) {
      commit();
      skippingUnreleased = true;
      continue;
    }

    const heading = RELEASE_HEADING.exec(line);
    if (heading) {
      skippingUnreleased = false;
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

    if (skippingUnreleased || !release) continue;

    const subgroup = SUBGROUP_HEADING.exec(line);
    if (subgroup) {
      if (!currentGroup) {
        throw new Error(`changelog: #### heading outside a ### group in v${release.version}`);
      }
      const entry: MutableGroup = { label: subgroup[1]!, items: [], subgroups: [] };
      currentGroup.subgroups.push(entry);
      openBullet = entry;
      continue;
    }

    const group = GROUP_HEADING.exec(line);
    if (group) {
      const entry: MutableGroup = { label: group[1]!, items: [], subgroups: [] };
      release.groups.push(entry);
      currentGroup = entry;
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
  const raw = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", CHANGELOG_SOURCE),
    "utf8",
  );
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

/**
 * Approximate token count for agent-readability gates (`ceil(chars / 4)`).
 *
 * @param text - Page body
 */
export function estimateAgentTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Minor-series slug for a published version (`0.12.3` → `0.12`).
 *
 * @param version - Bare semver from a release heading
 */
export function seriesSlugForVersion(version: string): string {
  const [major, minor] = version.split(".");
  if (major === undefined || minor === undefined) {
    throw new Error(`changelog: cannot derive series slug from ${version}`);
  }
  return `${major}.${minor}`;
}

/** One minor-version band rendered as its own page. */
export interface ChangelogSeries {
  /** URL slug, e.g. `0.12`. */
  readonly slug: string;
  readonly releases: ReadonlyArray<ChangelogRelease>;
}

/**
 * Group newest-first releases into minor-version series (still newest-first).
 *
 * @param releases - Output of {@link parseChangelog}
 */
export function partitionChangelogByMinor(
  releases: ReadonlyArray<ChangelogRelease>,
): ReadonlyArray<ChangelogSeries> {
  const order: string[] = [];
  const buckets = new Map<string, ChangelogRelease[]>();
  for (const release of releases) {
    const slug = seriesSlugForVersion(release.version);
    let bucket = buckets.get(slug);
    if (!bucket) {
      bucket = [];
      buckets.set(slug, bucket);
      order.push(slug);
    }
    bucket.push(release);
  }
  return order.map((slug) => ({ slug, releases: buckets.get(slug)! }));
}

/**
 * Load the canonical file and partition it. Fails if any series page would
 * exceed the agent-readability budget — split further rather than ship a wall.
 */
export function loadChangelogSeries(): ReadonlyArray<ChangelogSeries> {
  const series = partitionChangelogByMinor(loadChangelog());
  if (series.length === 0) {
    throw new Error(`changelog: no series partitioned from ${CHANGELOG_SOURCE}`);
  }
  for (const entry of series) {
    const tokens = estimateAgentTokens(renderChangelogSeriesMarkdown(entry));
    if (tokens > AGENT_READABILITY_TOKEN_BUDGET) {
      throw new Error(
        `changelog: series ${entry.slug} is ${tokens} tokens (budget ${AGENT_READABILITY_TOKEN_BUDGET})`,
      );
    }
  }
  return series;
}

/**
 * Look up one series by slug.
 *
 * @param series - Partitioned changelog
 * @param slug - Minor-version slug
 */
export function changelogSeriesBySlug(
  series: ReadonlyArray<ChangelogSeries>,
  slug: string,
): ChangelogSeries | undefined {
  return series.find((entry) => entry.slug === slug);
}

/**
 * HTML / markdown path for a series page.
 *
 * @param slug - Minor-version slug
 */
export function changelogSeriesPath(slug: string): string {
  return `/changelog/${slug}`;
}

/**
 * Stable fingerprint of one release for the 100% content-preservation gate.
 *
 * @param release - Parsed release
 */
export function changelogReleaseFingerprint(release: ChangelogRelease): string {
  return JSON.stringify({
    version: release.version,
    date: release.date,
    summary: release.summary,
    groups: release.groups,
  });
}

/**
 * Render parsed groups back to markdown (projection of changelog.md, not a fork).
 *
 * @param group - `###` group
 */
function renderGroupMarkdown(group: ChangelogGroup): string {
  const lines: string[] = [`### ${group.label}`, ""];
  for (const item of group.items) {
    lines.push(`- ${item}`, "");
  }
  for (const sub of group.subgroups) {
    lines.push(`#### ${sub.label}`, "");
    for (const item of sub.items) {
      lines.push(`- ${item}`, "");
    }
  }
  return lines.join("\n");
}

/**
 * Markdown body for one or more parsed releases.
 *
 * @param releases - Newest-first
 */
export function renderReleasesMarkdown(releases: ReadonlyArray<ChangelogRelease>): string {
  const parts: string[] = [];
  for (const release of releases) {
    parts.push(`## ${release.tag} — ${release.date}`, "");
    for (const line of release.summary) {
      parts.push(line, "");
    }
    for (const group of release.groups) {
      parts.push(renderGroupMarkdown(group));
    }
  }
  return `${parts.join("\n").trimEnd()}\n`;
}

/**
 * Index markdown listing every series page.
 *
 * @param series - Partitioned changelog
 */
export function renderChangelogIndexMarkdown(series: ReadonlyArray<ChangelogSeries>): string {
  const lines = [
    "# Changelog",
    "",
    `Release notes for okengine, split by minor version from \`${CHANGELOG_SOURCE}\`.`,
    "",
  ];
  for (const entry of series) {
    const newest = entry.releases[0];
    const oldest = entry.releases[entry.releases.length - 1];
    if (!newest || !oldest) continue;
    const dates = newest.date === oldest.date ? newest.date : `${oldest.date} – ${newest.date}`;
    const n = entry.releases.length;
    const noun = n === 1 ? "release" : "releases";
    lines.push(`- [${entry.slug}](${changelogSeriesPath(entry.slug)}) — ${n} ${noun}, ${dates}`);
  }
  lines.push("");
  return lines.join("\n");
}

/**
 * Markdown body for one minor-version page.
 *
 * @param series - One partitioned band
 */
export function renderChangelogSeriesMarkdown(series: ChangelogSeries): string {
  return `# Changelog ${series.slug}\n\n${renderReleasesMarkdown(series.releases)}`;
}

/**
 * Concatenate every series' releases in page order — must equal parseChangelog().
 *
 * @param series - Partitioned changelog
 */
export function flattenChangelogSeries(
  series: ReadonlyArray<ChangelogSeries>,
): ReadonlyArray<ChangelogRelease> {
  return series.flatMap((entry) => entry.releases);
}
