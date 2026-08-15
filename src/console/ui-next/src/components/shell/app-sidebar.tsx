/**
 * Authenticated Console sidebar — always icon-collapsed: Flows / Units / Store / Vault.
 */

import {
  AccessIcon,
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

const navItems = [
  {
    title: "Flows",
    to: "/flows" as const,
    icon: WorkflowSquare08Icon,
  },
  {
    title: "Units",
    to: "/units" as const,
    icon: Shapes01Icon,
  },
  {
    title: "Store",
    to: "/store" as const,
    icon: Archive02Icon,
  },
  {
    title: "Vault",
    to: "/vault" as const,
    icon: AccessIcon,
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
      <SidebarContent>
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
