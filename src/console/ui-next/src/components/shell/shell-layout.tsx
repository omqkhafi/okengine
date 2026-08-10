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
 * `/flows` renders full-bleed (no padding / gap); other sections keep the
 * padded inset.
 *
 * @param props - Operator from the session guard
 */
export function ShellLayout({ operator }: { readonly operator: SessionOperator }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const fullBleed = pathname === "/flows";

  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar operator={operator} />
      <SidebarInset>
        <div className={cn("flex flex-1 flex-col", fullBleed ? "" : "gap-4 p-4")}>
          <SidebarTrigger className="-ml-1 md:hidden" />
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
