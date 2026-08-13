/**
 * Authenticated Console sidebar — always icon-collapsed: Flows / Units / Store.
 */

import { Folder01Icon } from "@hugeicons/core-free-icons";
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
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";

const navItems = [
  {
    title: "Flows",
    to: "/flows" as const,
    icon: ELEMENT_ICONS.flow.icon,
  },
  {
    title: "Units",
    to: "/units" as const,
    icon: Folder01Icon,
  },
  {
    title: "Store",
    to: "/store" as const,
    icon: ELEMENT_ICONS.store.icon,
  },
] as const;

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

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-12 justify-center">
        <SidebarBrand />
      </SidebarHeader>
      <SidebarContent className="justify-center">
        <SidebarGroup className="items-center">
          <SidebarGroupLabel>Console</SidebarGroupLabel>
          <SidebarMenu className="items-center gap-3">
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
    </Sidebar>
  );
}
