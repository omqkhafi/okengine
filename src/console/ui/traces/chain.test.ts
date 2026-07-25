/**
 * Causal chain tests (console §9.3).
 */

import { describe, expect, test } from "bun:test";
import {
  buildCausalChain,
  groupTraceRoots,
  initialFocusSpanId,
} from "./chain.ts";
import { TRACES_FIXTURE } from "./fixture.ts";

describe("buildCausalChain", () => {
  test("joins emit consumer under parent across async boundary", () => {
    const chain = buildCausalChain(TRACES_FIXTURE, "run-fulfill");
    expect(chain).not.toBeNull();
    expect(chain?.parents.map((p) => p.id)).toEqual(["run-create-ok"]);
    expect(chain?.current.id).toBe("run-fulfill");
    expect(chain?.children).toEqual([]);
    expect(chain?.connected.map((s) => s.id)).toEqual([
      "run-create-ok",
      "run-fulfill",
    ]);
  });

  test("parents above, children below from root", () => {
    const chain = buildCausalChain(TRACES_FIXTURE, "run-create-ok");
    expect(chain?.parents).toEqual([]);
    expect(chain?.children.map((c) => c.id)).toEqual(["run-fulfill"]);
  });
});

describe("groupTraceRoots", () => {
  test("groups by root and lists newest first", () => {
    const roots = groupTraceRoots(TRACES_FIXTURE);
    expect(roots.map((r) => r.rootId)).toContain("run-create-ok");
    expect(roots.map((r) => r.rootId)).toContain("run-create-fail");
    expect(roots.map((r) => r.rootId)).toContain("run-ask");
    const ok = roots.find((r) => r.rootId === "run-create-ok");
    expect(ok?.spans.map((s) => s.id)).toEqual([
      "run-create-ok",
      "run-fulfill",
    ]);
  });
});

describe("initialFocusSpanId", () => {
  test("opens on the failing span", () => {
    const failRoot = groupTraceRoots(TRACES_FIXTURE).find(
      (r) => r.rootId === "run-create-fail",
    );
    expect(initialFocusSpanId(failRoot!.spans)).toBe("run-create-fail");
  });

  test("honours preferred id when present", () => {
    const ok = groupTraceRoots(TRACES_FIXTURE).find(
      (r) => r.rootId === "run-create-ok",
    );
    expect(initialFocusSpanId(ok!.spans, "run-fulfill")).toBe("run-fulfill");
  });
});
