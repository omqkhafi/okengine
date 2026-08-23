/**
 * Gate: changelog split preserves every published release and stays under budget.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  AGENT_READABILITY_TOKEN_BUDGET,
  CHANGELOG_SOURCE,
  changelogReleaseFingerprint,
  estimateAgentTokens,
  flattenChangelogSeries,
  parseChangelog,
  partitionChangelogByMinor,
  renderChangelogIndexMarkdown,
  renderChangelogSeriesMarkdown,
} from "./changelog.ts";

const ROOT = join(import.meta.dir, "..", "..");

describe("changelog split", () => {
  test("concatenating series pages equals parseChangelog — no silent loss", async () => {
    const raw = await Bun.file(join(ROOT, CHANGELOG_SOURCE)).text();
    const releases = parseChangelog(raw);
    const series = partitionChangelogByMinor(releases);

    expect(flattenChangelogSeries(series).map(changelogReleaseFingerprint)).toEqual(
      releases.map(changelogReleaseFingerprint),
    );

    const seen = new Set<string>();
    for (const entry of series) {
      const markdown = renderChangelogSeriesMarkdown(entry);
      for (const release of entry.releases) {
        expect(markdown).toContain(`## ${release.tag} — ${release.date}`);
        for (const line of release.summary) {
          expect(markdown).toContain(line);
        }
        for (const group of release.groups) {
          expect(markdown).toContain(group.label);
          for (const item of group.items) {
            expect(markdown).toContain(item);
            expect(seen.has(`${release.version}:${item}`)).toBe(false);
            seen.add(`${release.version}:${item}`);
          }
          for (const sub of group.subgroups) {
            expect(markdown).toContain(sub.label);
            for (const item of sub.items) {
              expect(markdown).toContain(item);
              expect(seen.has(`${release.version}:${item}`)).toBe(false);
              seen.add(`${release.version}:${item}`);
            }
          }
        }
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });

  test("index and every series page stay under the agent-readability budget", async () => {
    const raw = await Bun.file(join(ROOT, CHANGELOG_SOURCE)).text();
    const series = partitionChangelogByMinor(parseChangelog(raw));
    const index = renderChangelogIndexMarkdown(series);
    expect(estimateAgentTokens(index)).toBeLessThanOrEqual(AGENT_READABILITY_TOKEN_BUDGET);
    expect(index).toContain("/changelog/");

    for (const entry of series) {
      const tokens = estimateAgentTokens(renderChangelogSeriesMarkdown(entry));
      expect(tokens, `${entry.slug} is ${tokens} tokens`).toBeLessThanOrEqual(
        AGENT_READABILITY_TOKEN_BUDGET,
      );
    }

    const unsplit = estimateAgentTokens(raw);
    expect(unsplit).toBeGreaterThan(AGENT_READABILITY_TOKEN_BUDGET);
    expect(series.length).toBeGreaterThan(1);
  });
});
