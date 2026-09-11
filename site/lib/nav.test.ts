/**
 * Gate: the header tab strip is the whole site nav, so every tab must resolve to
 * a real route and exactly one tab may be active for any pathname.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { hasDocsPane, headerGeometry, isNavTabActive, NAV_TABS } from "./nav.ts";

const APP = join(import.meta.dir, "..", "app");

describe("NAV_TABS", () => {
  test("every tab resolves to a route on disk", async () => {
    const routes: Record<string, string> = {
      "/": "(home)/page.tsx",
      "/docs": "docs/[[...slug]]/page.tsx",
      "/changelog": "changelog/page.tsx",
    };

    for (const tab of NAV_TABS) {
      const route = routes[tab.href];
      expect(route, `no route mapped for ${tab.href}`).toBeDefined();
      expect(await Bun.file(join(APP, route!)).exists()).toBe(true);
    }
  });

  test("exactly one tab is active per surface", () => {
    const pathnames = [
      "/",
      "/docs",
      "/docs/understand/the-architecture",
      "/docs/elements/flow",
      "/changelog",
      "/changelog/0.17",
    ];

    for (const pathname of pathnames) {
      const active = NAV_TABS.filter((tab) => isNavTabActive(tab, pathname));
      expect(active.map((tab) => tab.id)).toHaveLength(1);
    }
  });

  test("the home tab does not match nested routes", () => {
    const home = NAV_TABS.find((tab) => tab.href === "/")!;
    expect(isNavTabActive(home, "/")).toBe(true);
    expect(isNavTabActive(home, "/docs")).toBe(false);
    expect(isNavTabActive(home, "/changelog")).toBe(false);
  });

  test("labels are lowercase — the strip uppercases them in CSS", () => {
    for (const tab of NAV_TABS) {
      expect(tab.label).toBe(tab.label.toLowerCase());
    }
  });
});

/*
 * Docs and changelog surfaces share a left pane with the header brand cell —
 * those widths are asserted against the page shell below. Home is a centered
 * full-bleed hero, so the brand-cell width is header-only.
 */
describe("headerGeometry", () => {
  test("the home brand cell keeps a fixed pane width (header-only)", () => {
    expect(headerGeometry("/").paneWidth).toBe("44%");
  });

  test("the home hero is a centered stage without a left-pane width class", async () => {
    const page = await Bun.file(join(APP, "(home)", "page.tsx")).text();
    expect(page).toContain("max-w-7xl");
    expect(page).not.toContain("lg:w-[44%]");
  });

  test("the changelog cell matches the release rail's split", async () => {
    const shell = await Bun.file(
      join(import.meta.dir, "..", "components", "release-notes", "shell.tsx"),
    ).text();
    expect(shell).toContain(`lg:w-[${headerGeometry("/changelog").paneWidth}]`);
    expect(headerGeometry("/changelog/0.17")).toEqual(headerGeometry("/changelog"));
  });

  test("the docs cell width is the shared left-pane token", async () => {
    const token = "--landing-left-pane-width";
    expect(headerGeometry("/docs").paneWidth).toBe(`var(${token})`);
    // The same token sizes the sidebar directly beneath the cell.
    const sidebar = await Bun.file(
      join(import.meta.dir, "..", "components", "chrome", "docs-sidebar.tsx"),
    ).text();
    expect(sidebar).toContain(`w-(${token})`);
  });

  test("no surface is framed, so the header can stay full-bleed", async () => {
    for (const file of ["(home)/page.tsx", "changelog/page.tsx", "changelog/[series]/page.tsx"]) {
      expect(await Bun.file(join(APP, file)).text()).not.toContain("max-w-360");
    }
    const band = await Bun.file(
      join(import.meta.dir, "..", "components", "landing", "band.tsx"),
    ).text();
    expect(band).not.toContain("max-w-360");
  });
});

describe("hasDocsPane", () => {
  test("matches /docs and its descendants only", () => {
    expect(hasDocsPane("/docs")).toBe(true);
    expect(hasDocsPane("/docs/cli")).toBe(true);
    expect(hasDocsPane("/")).toBe(false);
    expect(hasDocsPane("/changelog")).toBe(false);
    expect(hasDocsPane("/changelog/0.17")).toBe(false);
    expect(hasDocsPane("/docsearch")).toBe(false);
  });
});
