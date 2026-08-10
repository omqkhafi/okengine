/**
 * Authenticated shell — sidebar-07 scaffold, collapsed by default.
 */

import { Outlet, useRouterState } from "@tanstack/react-router";
import { AppSidebar } from "@/components/shell/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import type { SessionOperator } from "@/client.ts";

const titles: Record<string, string> = {
  "/overview": "Overview",
  "/flows": "Flows",
  "/store": "Store",
};

/**
 * Shell chrome around authenticated panel routes.
 *
 * @param props - Operator from the session guard
 */
export function ShellLayout({ operator }: { readonly operator: SessionOperator }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const title = titles[pathname] ?? "Console";

  return (
    <SidebarProvider defaultOpen={false}>
      <AppSidebar operator={operator} />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-auto"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>{title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
