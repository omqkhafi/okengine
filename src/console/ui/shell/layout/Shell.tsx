/**
 * Console chrome — navigation is the eight elements (console §1).
 */

import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { clsx } from "clsx";
import type { ReactNode } from "react";

/**
 * Primary nav — eight elements, then cross-cutting panels (console §9).
 * Listed-but-off entries stay visible so navigation teaches the framework.
 */
const NAV: ReadonlyArray<{
  readonly to: string;
  readonly label: string;
  readonly enabled: boolean;
}> = [
  { to: "/", label: "Overview", enabled: true },
  { to: "/flows", label: "Flows", enabled: true },
  { to: "/signals", label: "Signals", enabled: false },
  { to: "/store", label: "Store", enabled: false },
  { to: "/clock", label: "Clock", enabled: false },
  { to: "/gates", label: "Gates", enabled: false },
  { to: "/vault", label: "Vault", enabled: false },
  { to: "/channels", label: "Channels", enabled: false },
  { to: "/ai", label: "AI", enabled: false },
  { to: "/traces", label: "Traces", enabled: true },
  { to: "/runs", label: "Runs", enabled: true },
];

/**
 * Shell with element navigation + outlet.
 *
 * @param props - Optional children override (defaults to Outlet)
 */
export function Shell({ children }: { readonly children?: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex h-full min-h-0 flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-[var(--oke-bg)] focus:px-3 focus:py-2"
      >
        Skip to main content
      </a>
      <nav
        aria-label="Console"
        className="flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--oke-line)] px-3"
      >
        <span className="mr-3 font-mono text-xs tracking-[0.2em] text-[var(--oke-muted)]">
          oke
        </span>
        {NAV.map((item) =>
          item.enabled ? (
            <Link
              key={item.to}
              to={item.to}
              className={clsx(
                "inline-flex min-h-8 items-center px-2 text-sm",
                pathname === item.to
                  ? "text-[var(--oke-fg)]"
                  : "text-[var(--oke-muted)]",
              )}
              aria-current={pathname === item.to ? "page" : undefined}
            >
              {item.label}
            </Link>
          ) : (
            <span
              key={item.to}
              className="inline-flex min-h-8 items-center px-2 text-sm text-[var(--oke-muted)] opacity-40"
              title="Coming soon"
            >
              {item.label}
            </span>
          ),
        )}
      </nav>
      <div id="main" className="min-h-0 flex-1 overflow-hidden">
        {children ?? <Outlet />}
      </div>
    </div>
  );
}
