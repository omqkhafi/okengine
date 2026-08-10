/**
 * Authenticated Console sidebar — sidebar-07 layout, Overview / Flows / Store only.
 */

import {
  DashboardSquare01Icon,
  Database01Icon,
  WorkflowSquare01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { OkeLogo, OkeLogoIcon } from "@/components/oke-logo";
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
  SidebarRail,
} from "@/components/ui/sidebar";
import type { SessionOperator } from "@/client.ts";

const navItems = [
  {
    title: "Overview",
    to: "/overview" as const,
    icon: DashboardSquare01Icon,
  },
  {
    title: "Flows",
    to: "/flows" as const,
    icon: WorkflowSquare01Icon,
  },
  {
    title: "Store",
    to: "/store" as const,
    icon: Database01Icon,
  },
] as const;

/**
 * Collapsible icon sidebar for the authenticated Console shell.
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

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-16 justify-center transition-[height] ease-linear group-data-[collapsible=icon]:h-12">
        <div className="flex items-center gap-2 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <OkeLogo className="h-5 w-auto shrink-0 group-data-[collapsible=icon]:hidden" />
          <OkeLogoIcon className="hidden size-5 shrink-0 group-data-[collapsible=icon]:block" />
        </div>
      </SidebarHeader>
      <SidebarContent className="justify-center">
        <SidebarGroup className="group-data-[collapsible=icon]:items-center">
          <SidebarGroupLabel>Console</SidebarGroupLabel>
          <SidebarMenu className="gap-2 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-3">
            {navItems.map((item) => (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  render={<Link to={item.to} />}
                  isActive={pathname === item.to}
                  tooltip={item.title}
                >
                  <HugeiconsIcon icon={item.icon} />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser operator={operator} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
