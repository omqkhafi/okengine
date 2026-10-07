#!/usr/bin/env bun
/**
 * Create the GitHub Release for a pushed `v*` tag from that version's
 * changelog section, then close the matching milestone (exact title, then
 * the major.minor release train). Does not publish packages.
 */

import { ghApi, isRecord } from "./gh.ts";
import { changelogSection, milestoneTitlesForVersion } from "./changelog.ts";

const repo = process.env["GITHUB_REPOSITORY"] ?? "omqkhafi/okengine";

function tagName(): string {
  const ref = process.env["GITHUB_REF"] ?? "";
  const tag = ref.replace("refs/tags/", "");
  if (!tag.startsWith("v")) throw new Error(`GITHUB_REF is not a v* tag: ${ref}`);
  return tag;
}

async function ensureRelease(tag: string, notes: string): Promise<void> {
  const view = Bun.spawn(["gh", "release", "view", tag, "--repo", repo], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const [viewCode] = await Promise.all([view.exited, new Response(view.stderr).text()]);
  const args =
    viewCode === 0
      ? ["release", "edit", tag, "--repo", repo, "--notes-file", "-"]
      : ["release", "create", tag, "--repo", repo, "--title", tag, "--notes-file", "-"];
  const proc = Bun.spawn(["gh", ...args], {
    stdin: Buffer.from(notes),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`gh ${args.join(" ")} failed (${code}): ${stderr.trim()}`);
}

async function closeMilestone(titles: readonly string[]): Promise<void> {
  const raw = await ghApi([`repos/${repo}/milestones?state=all&per_page=100`]);
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("milestone list was not an array");
  for (const title of titles) {
    for (const entry of parsed) {
      if (!isRecord(entry) || entry["title"] !== title || typeof entry["number"] !== "number")
        continue;
      await ghApi([
        "--method",
        "PATCH",
        `repos/${repo}/milestones/${entry["number"]}`,
        "-f",
        "state=closed",
      ]);
      console.log(`closed milestone ${title}`);
      return;
    }
  }
  throw new Error(`no milestone titled ${titles.join(" or ")}`);
}

if (import.meta.main) {
  const tag = tagName();
  const version = tag.slice(1);
  const notes = changelogSection(await Bun.file("changelog.md").text(), version);
  if (notes === null) throw new Error(`changelog.md has no ## v${version} section`);
  await ensureRelease(tag, notes);
  console.log(`release ${tag} updated from changelog`);
  await closeMilestone(milestoneTitlesForVersion(version));
}
