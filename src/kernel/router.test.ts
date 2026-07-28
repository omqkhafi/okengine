import { describe, expect, test } from "bun:test";
import {
  createRouter,
  LinearRouter,
  RegExpRouter,
  TrieRouter,
  UnsupportedPathError,
} from "./router.ts";

describe("router — RegExp + Trie + Linear + Smart", () => {
  test("RegExpRouter matches static and param routes", () => {
    const r = new RegExpRouter<string>();
    r.add("GET", "/notes", "list");
    r.add("GET", "/notes/:id", "get");
    r.add("POST", "/notes", "create");
    r.build();

    expect(r.match("GET", "/notes")).toEqual({ value: "list", params: {} });
    expect(r.match("GET", "/notes/n1")).toEqual({
      value: "get",
      params: { id: "n1" },
    });
    expect(r.match("POST", "/notes")?.value).toBe("create");
    expect(r.match("GET", "/missing")).toBeUndefined();
  });

  test("RegExpRouter rejects wildcards", () => {
    const r = new RegExpRouter<string>();
    expect(() => r.add("GET", "/files/*", "x")).toThrow(UnsupportedPathError);
  });

  test("TrieRouter handles wildcards the RegExp path cannot", () => {
    const r = new TrieRouter<string>();
    r.add("GET", "/assets/*", "asset");
    r.add("GET", "/users/:id", "user");

    expect(r.match("GET", "/users/u1")).toEqual({
      value: "user",
      params: { id: "u1" },
    });
    expect(r.match("GET", "/assets/a/b/c")).toEqual({
      value: "asset",
      params: { "*": "a/b/c" },
    });
  });

  test("SmartRouter default selects RegExpRouter", () => {
    const r = createRouter<number>("default");
    r.add("GET", "/a", 1);
    r.add("GET", "/b/:id", 2);
    r.build();
    expect(r.activeRouter.name).toBe("RegExpRouter");
    expect(r.match("GET", "/b/9")).toEqual({ value: 2, params: { id: "9" } });
  });

  test("SmartRouter falls back to Trie when RegExp cannot express a path", () => {
    const r = createRouter<string>("default");
    r.add("GET", "/ok", "a");
    r.add("GET", "/files/*", "b");
    r.build();
    expect(r.activeRouter.name).toBe("TrieRouter");
    expect(r.match("GET", "/files/x/y")?.value).toBe("b");
  });

  test("edge preset uses LinearRouter", () => {
    const r = createRouter<string>("edge");
    r.add("GET", "/x/:id", "x");
    r.build();
    expect(r.activeRouter.name).toBe("LinearRouter");
    expect(r.match("GET", "/x/1")).toEqual({ value: "x", params: { id: "1" } });
  });

  test("compiled RegExp beats linear scan by ≥10× at 200 routes", () => {
    const N = 200;
    const paths: string[] = [];
    for (let i = 0; i < N; i++) {
      paths.push(`/r${i}/:id/leaf`);
    }
    // Match near the end so linear pays full cost.
    const target = `/r${N - 1}/item/leaf`;

    const linear = new LinearRouter<number>();
    const regexp = new RegExpRouter<number>();
    for (let i = 0; i < N; i++) {
      linear.add("GET", paths[i]!, i);
      regexp.add("GET", paths[i]!, i);
    }
    regexp.build();

    // Warm
    for (let i = 0; i < 100; i++) {
      linear.match("GET", target);
      regexp.match("GET", target);
    }

    const iterations = 20_000;
    let best = 0;
    for (let trial = 0; trial < 3; trial++) {
      const t0 = performance.now();
      for (let i = 0; i < iterations; i++) {
        linear.match("GET", target);
      }
      const linearMs = performance.now() - t0;

      const t1 = performance.now();
      for (let i = 0; i < iterations; i++) {
        regexp.match("GET", target);
      }
      const regexpMs = performance.now() - t1;
      best = Math.max(best, linearMs / regexpMs);
    }

    expect(regexp.match("GET", target)?.value).toBe(N - 1);
    expect(best).toBeGreaterThanOrEqual(10);
  });
});
