import { describe, expect, test } from "bun:test";

import { unreleasedChanged } from "./changelog.ts";
import {
  breakingSectionHasContent,
  evaluatePr,
  type LinkedIssue,
  type PrSnapshot,
} from "./check-pr.ts";

const task: LinkedIssue = {
  number: 1,
  exists: true,
  typeName: "Task",
  subIssueCount: 0,
  milestone: "0.24",
  onBoard: true,
};

/** A feature pull request that satisfies every check. */
function valid(over: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    title: "feat(ai): add a pluggable decider",
    body: ["## Summary", "", "Deciders load from the lockfile.", "", "Closes #1", ""].join("\n"),
    author: "omqkhafi",
    labels: ["type: feature", "area: ai"],
    milestone: "0.24",
    baseRef: "dev",
    headRef: "feat/pluggable-decider",
    changelogAddedUnderUnreleased: true,
    linkedIssues: [task],
    ...over,
  };
}

describe("evaluatePr", () => {
  test("accepts a valid pull request", () => {
    expect(evaluatePr(valid())).toEqual([]);
  });

  test("accepts a chore pull request without a changelog entry", () => {
    const failures = evaluatePr(
      valid({
        title: "chore(ci): set up the GitHub workflow",
        labels: ["type: chore", "area: ci"],
        changelogAddedUnderUnreleased: false,
        headRef: "chore/github-workflow",
      }),
    );
    expect(failures).toEqual([]);
  });

  test("reports each single failure on its own", () => {
    const cases: readonly (readonly [string, Partial<PrSnapshot>, string])[] = [
      [
        "title",
        { title: "set up the workflow" },
        "title must match type(scope): summary (feat, fix, docs, refactor, perf, test, chore; ! marks breaking)",
      ],
      [
        "type label mismatch",
        { labels: ["type: fix", "area: ai"] },
        "title type feat must use label type: feature",
      ],
      [
        "missing type label",
        { labels: ["area: ai"] },
        "pull request needs exactly one type: label (found 0)",
      ],
      [
        "two type labels",
        { labels: ["type: feature", "type: fix", "area: ai"] },
        "pull request needs exactly one type: label (found 2)",
      ],
      [
        "missing area",
        { labels: ["type: feature"] },
        "pull request needs at least one area: label",
      ],
      ["unset milestone", { milestone: null }, "pull request milestone is not set"],
      [
        "no link",
        { body: "No issue link.", linkedIssues: [] },
        "body must contain Closes #N or Refs #N",
      ],
      [
        "missing issue",
        {
          body: "Closes #9",
          linkedIssues: [
            {
              number: 9,
              exists: false,
              typeName: null,
              subIssueCount: 0,
              milestone: null,
              onBoard: null,
            },
          ],
        },
        "issue #9 does not exist",
      ],
      [
        "off the board",
        { linkedIssues: [{ ...task, onBoard: false }] },
        "issue #1 is not on the okengine board",
      ],
      [
        "changelog",
        { changelogAddedUnderUnreleased: false },
        "changelog.md needs an entry under ## Unreleased",
      ],
      [
        "main from a feature branch",
        { baseRef: "main", headRef: "feat/pluggable-decider" },
        "pull requests into main must come from dev",
      ],
    ];
    for (const [name, over, message] of cases) {
      expect(evaluatePr(valid(over)), name).toEqual([message]);
    }
  });

  test("reports multiple failures together", () => {
    expect(
      evaluatePr(
        valid({
          title: "wip",
          labels: [],
          milestone: null,
          body: "See the notes.",
          linkedIssues: [],
          changelogAddedUnderUnreleased: false,
        }),
      ),
    ).toEqual([
      "title must match type(scope): summary (feat, fix, docs, refactor, perf, test, chore; ! marks breaking)",
      "pull request needs exactly one type: label (found 0)",
      "pull request needs at least one area: label",
      "pull request milestone is not set",
      "body must contain Closes #N or Refs #N",
      "changelog.md needs an entry under ## Unreleased",
    ]);
  });

  test("requires the breaking label for a bang and for a filled breaking section", () => {
    expect(evaluatePr(valid({ title: "feat(ai)!: add a pluggable decider" }))).toEqual([
      "breaking title or section needs the breaking label",
    ]);
    expect(
      evaluatePr(
        valid({
          body: [
            "Closes #1",
            "",
            "## 💥 Breaking",
            "",
            "Before: `decide()`",
            "",
            "After: `decide(model)`",
          ].join("\n"),
        }),
      ),
    ).toEqual(["breaking title or section needs the breaking label"]);
  });

  test("ignores an empty breaking section", () => {
    const body = [
      "Closes #1",
      "",
      "## 💥 Breaking",
      "",
      "<!-- Before:",
      "",
      "After:",
      "-->",
      "",
    ].join("\n");
    expect(breakingSectionHasContent(body)).toBe(false);
    expect(evaluatePr(valid({ body }))).toEqual([]);
  });

  test("accepts a breaking change that carries the label", () => {
    expect(
      evaluatePr(
        valid({
          title: "feat(ai)!: add a pluggable decider",
          labels: ["type: feature", "area: ai", "breaking"],
        }),
      ),
    ).toEqual([]);
  });

  test("rejects a milestone that differs from the linked issue", () => {
    expect(evaluatePr(valid({ linkedIssues: [{ ...task, milestone: "0.25" }] }))).toEqual([
      "pull request milestone 0.24 does not match issue #1 milestone 0.25",
    ]);
  });

  test("rejects Closes pointing at an Epic", () => {
    expect(evaluatePr(valid({ linkedIssues: [{ ...task, typeName: "Epic" }] }))).toEqual([
      "issue #1 is an Epic; a pull request closes a leaf issue",
    ]);
  });

  test("rejects Closes pointing at an issue with sub-issues and no type", () => {
    expect(
      evaluatePr(valid({ linkedIssues: [{ ...task, typeName: null, subIssueCount: 3 }] })),
    ).toEqual(["issue #1 is an Epic; a pull request closes a leaf issue"]);
  });

  test("accepts a Dependabot pull request without a linked issue or milestone", () => {
    expect(
      evaluatePr(
        valid({
          author: "dependabot[bot]",
          title: "chore(deps): bump actions/checkout from 4 to 5",
          labels: ["type: chore", "area: ci"],
          body: "Bumps the github-actions group.",
          milestone: null,
          linkedIssues: [],
          changelogAddedUnderUnreleased: false,
        }),
      ),
    ).toEqual([]);
  });

  test("rejects a Dependabot pull request with a bad title", () => {
    expect(
      evaluatePr(
        valid({
          author: "dependabot[bot]",
          title: "Bump actions/checkout from 4 to 5",
          labels: ["type: chore", "area: ci"],
          body: "Bumps the github-actions group.",
          milestone: null,
          linkedIssues: [],
          changelogAddedUnderUnreleased: false,
        }),
      ),
    ).toEqual([
      "title must match type(scope): summary (feat, fix, docs, refactor, perf, test, chore; ! marks breaking)",
    ]);
  });

  test("accepts Refs for partial work", () => {
    expect(evaluatePr(valid({ body: "Refs #1\n" }))).toEqual([]);
  });

  test("skips the board check when membership is unknown", () => {
    expect(evaluatePr(valid({ linkedIssues: [{ ...task, onBoard: null }] }))).toEqual([]);
  });
});

describe("unreleasedChanged", () => {
  const base = "## Unreleased\n\n## v0.23.2 — 2026-10-07\n\n- old\n";

  test("sees a new unreleased bullet", () => {
    const head = "## Unreleased\n\n- GitHub workflow.\n\n## v0.23.2 — 2026-10-07\n\n- old\n";
    expect(unreleasedChanged(base, head)).toBe(true);
  });

  test("ignores edits below Unreleased", () => {
    const head = "## Unreleased\n\n## v0.23.2 — 2026-10-07\n\n- rewritten\n";
    expect(unreleasedChanged(base, head)).toBe(false);
  });
});
