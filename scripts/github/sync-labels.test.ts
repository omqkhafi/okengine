import { describe, expect, test } from "bun:test";

import { formatLabelAction, planLabelSync, type LabelSpec, type LiveLabel } from "./sync-labels.ts";

const feature: LabelSpec = {
  name: "type: feature",
  color: "1D76DB",
  description: "Pull request work kind: a feature",
};
const fix: LabelSpec = {
  name: "type: fix",
  color: "D73A4A",
  description: "Pull request work kind: a fix",
};

const defaults: readonly LiveLabel[] = [
  { name: "bug", color: "d73a4a", description: "Something isn't working" },
  { name: "enhancement", color: "a2eeef", description: "New feature or request" },
  { name: "duplicate", color: "cfd3d7", description: "This issue or pull request already exists" },
  { name: "wontfix", color: "ffffff", description: "This will not be worked on" },
];

describe("planLabelSync", () => {
  test("renames a mapped default, creates the rest, and deletes unused defaults", () => {
    const actions = planLabelSync({
      desired: [feature, fix],
      renames: { bug: "type: fix", enhancement: "type: feature" },
      live: defaults,
      counts: { bug: 0, enhancement: 0, duplicate: 0, wontfix: 0 },
    });
    expect(actions.map(formatLabelAction)).toEqual([
      "rename bug -> type: fix",
      "rename enhancement -> type: feature",
      "delete duplicate (0 issues or pull requests)",
      "delete wontfix (0 issues or pull requests)",
    ]);
  });

  test("keeps a label that is on an issue or pull request", () => {
    const actions = planLabelSync({
      desired: [fix],
      renames: {},
      live: [{ name: "wontfix", color: "ffffff", description: "This will not be worked on" }],
      counts: { wontfix: 3 },
    });
    expect(actions).toEqual([
      { kind: "create", label: fix },
      { kind: "keep", name: "wontfix", count: 3 },
    ]);
  });

  test("keeps a label when its use count is unknown", () => {
    const actions = planLabelSync({
      desired: [fix],
      renames: {},
      live: [
        { name: "question", color: "d876e3", description: "Further information is requested" },
      ],
      counts: {},
    });
    expect(actions.some((action) => action.kind === "delete")).toBe(false);
    expect(actions).toContainEqual({ kind: "keep", name: "question", count: null });
  });

  test("updates color and description without renaming", () => {
    const actions = planLabelSync({
      desired: [fix],
      renames: { bug: "type: fix" },
      live: [{ name: "type: fix", color: "000000", description: "old" }],
      counts: {},
    });
    expect(actions).toEqual([{ kind: "update", label: fix }]);
  });
});
