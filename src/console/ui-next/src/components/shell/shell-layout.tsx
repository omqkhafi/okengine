/**
 * Authenticated shell — sidebar-07 scaffold, always icon-collapsed on desktop.
 */

import { Outlet, useRouterState } from "@tanstack/react-router";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { SessionOperator } from "@/client.ts";

/**
 * Shell chrome around authenticated panel routes.
 *
 * `/overview`, `/flows`, `/store`, and `/vault` render full-bleed (no padding / gap); other
 * sections keep the padded inset. Desktop sidebar stays icon-collapsed; mobile
 * still uses the sheet trigger.
 *
 * @param props - Operator from the session guard
 */
export function ShellLayout({ operator }: { readonly operator: SessionOperator }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const fullBleed =
    pathname === "/overview" ||
    pathname === "/flows" ||
    pathname === "/store" ||
    pathname === "/vault";

  return (
    <SidebarProvider
      open={false}
      className={fullBleed ? "h-svh max-h-svh overflow-hidden" : undefined}
    >
      <AppSidebar operator={operator} />
      <SidebarInset className={fullBleed ? "min-h-0 max-h-svh overflow-hidden" : undefined}>
        <div
          className={cn(
            "flex flex-col",
            fullBleed ? "h-svh max-h-svh min-h-0 overflow-hidden" : "flex-1 gap-4 p-4",
          )}
        >
          <SidebarTrigger className="-ml-1 md:hidden" />
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
