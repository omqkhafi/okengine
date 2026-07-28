/**
 * Accessibility gate — axe reports zero violations at WCAG 2.2 AA
 * (console §7.5 · §9.16).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import axe from "axe-core";
import { Window } from "happy-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { OverviewA11yView } from "./OverviewA11yView.tsx";

describe("Overview panel accessibility", () => {
  let window: Window;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window = new Window({ url: "http://console.test/overview" });
    Object.defineProperty(globalThis, "window", {
      value: window,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: window.document,
      configurable: true,
    });
    Object.defineProperty(globalThis, "HTMLElement", {
      value: window.HTMLElement,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "Node", {
      value: window.Node,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: window.navigator,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      value: window.getComputedStyle.bind(window),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "requestAnimationFrame", {
      value: (cb: FrameRequestCallback) => window.setTimeout(cb, 0),
      configurable: true,
      writable: true,
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.close();
  });

  test("axe reports zero violations at WCAG 2.2 AA (burning state)", async () => {
    await act(async () => {
      root.render(<OverviewA11yView />);
    });

    await new Promise((r) => setTimeout(r, 10));

    const results = await axe.run(container, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag22aa"],
      },
    });

    if (results.violations.length > 0) {
      const summary = results.violations
        .map(
          (v) =>
            `${v.id}: ${v.help} (${v.nodes.length} nodes) — ${v.nodes.map((n) => n.html).join("; ")}`,
        )
        .join("\n");
      console.error(summary);
    }

    expect(results.violations).toEqual([]);
  });

  test("axe reports zero violations at WCAG 2.2 AA (day-one empty SLOs)", async () => {
    await act(async () => {
      root.render(<OverviewA11yView dayOne />);
    });

    await new Promise((r) => setTimeout(r, 10));

    const results = await axe.run(container, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag22aa"],
      },
    });

    expect(results.violations).toEqual([]);
  });
});
