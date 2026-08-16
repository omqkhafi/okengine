/**
 * Authenticated Console sidebar — always icon-collapsed: Overview / Flows / Store / Vault / Monitoring.
 */

import {
  AccessIcon,
  Activity03Icon,
  Archive02Icon,
  Shapes01Icon,
  WorkflowSquare08Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { OkeLogoIcon } from "@/components/oke-logo";
import { NavUser } from "@/components/shell/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { SessionOperator } from "@/client.ts";
import { lastSearchFor, type ConsoleModulePath } from "@/lib/last-module-search.ts";
import { useLastModuleSearch } from "@/lib/use-last-module-search.ts";

const navItems: ReadonlyArray<{
  readonly title: string;
  readonly to: ConsoleModulePath;
  readonly icon: typeof WorkflowSquare08Icon;
}> = [
  { title: "Overview", to: "/overview", icon: WorkflowSquare08Icon },
  { title: "Flows", to: "/flows", icon: Shapes01Icon },
  { title: "Store", to: "/store", icon: Archive02Icon },
  { title: "Vault", to: "/vault", icon: AccessIcon },
  { title: "Monitoring", to: "/monitoring", icon: Activity03Icon },
];

/**
 * Icon-only brand mark for the always-collapsed sidebar header.
 */
function SidebarBrand() {
  return (
    <div className="flex w-full items-center justify-center px-0">
      <OkeLogoIcon className="size-5" />
    </div>
  );
}

/**
 * Always-collapsed icon sidebar for the authenticated Console shell.
 *
 * @param props - Sidebar props plus the signed-in operator
 */
export function AppSidebar({
  operator,
  ...props
}: ComponentProps<typeof Sidebar> & {
  readonly operator: SessionOperator;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const memory = useLastModuleSearch();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-12 justify-center">
        <SidebarBrand />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="items-stretch p-0">
          <SidebarGroupLabel>Console</SidebarGroupLabel>
          <SidebarMenu className="items-stretch gap-0">
            {navItems.map((item) => (
              <SidebarMenuItem key={item.to} className="w-full">
                <SidebarMenuButton
                  render={<Link to={item.to} search={lastSearchFor(memory, item.to) as never} />}
                  isActive={pathname === item.to}
                  tooltip={item.title}
                  className="rounded-none! justify-center hover:bg-muted/50! hover:text-foreground data-active:bg-muted/70! data-active:text-foreground group-data-[collapsible=icon]:h-10! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:p-0!"
                >
                  <HugeiconsIcon icon={item.icon} />
                  <span className="sr-only">{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser operator={operator} />
      </SidebarFooter>
    </Sidebar>
  );
}
