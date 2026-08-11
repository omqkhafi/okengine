/**
 * Authenticated shell — sidebar-07 scaffold, collapsed by default.
 */

import { Outlet, useRouterState } from "@tanstack/react-router";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { SessionOperator } from "@/client.ts";

/**
 * Shell chrome around authenticated panel routes.
 *
 * `/flows` and `/units` render full-bleed (no padding / gap); other sections
 * keep the padded inset.
 *
 * @param props - Operator from the session guard
 */
export function ShellLayout({ operator }: { readonly operator: SessionOperator }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const fullBleed = pathname === "/flows" || pathname === "/units";

  return (
    <SidebarProvider
      defaultOpen={false}
      className={fullBleed ? "h-svh max-h-svh overflow-hidden" : undefined}
    >
      <AppSidebar operator={operator} />
      <SidebarInset
        className={fullBleed ? "min-h-0 max-h-svh overflow-hidden" : undefined}
      >
        <div
          className={cn(
            "flex flex-col",
            fullBleed
              ? "h-svh max-h-svh min-h-0 overflow-hidden"
              : "flex-1 gap-4 p-4",
          )}
        >
          <SidebarTrigger className="-ml-1 md:hidden" />
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
