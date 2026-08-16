/**
 * Authenticated Console sidebar — always icon-collapsed: Overview / Flows / Store / Observability / Vault.
 */

import {
  AccessIcon,
  Archive02Icon,
  ChartAnalysisIcon,
  Shapes01Icon,
  WorkflowSquare08Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { OkeLogoIcon } from "@/components/oke-logo";
import { NavFooter } from "@/components/shell/nav-footer";
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
import { lastSearchFor, type ConsoleModulePath } from "@/lib/last-module-search.ts";
import { ShortcutTipLabel } from "@/lib/shortcut-keys.tsx";
import { consoleShortcut, type ConsoleShortcutId } from "@/lib/shortcut.ts";
import { useLastModuleSearch } from "@/lib/use-last-module-search.ts";

const NAV_ITEM_CLASS =
  "rounded-none! justify-center hover:bg-muted/50! hover:text-foreground data-active:bg-muted/70! data-active:text-foreground group-data-[collapsible=icon]:h-10! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:p-0!";

const navItems: ReadonlyArray<{
  readonly title: string;
  readonly to: ConsoleModulePath;
  readonly icon: typeof WorkflowSquare08Icon;
  readonly shortcut: Exclude<ConsoleShortcutId, "fast" | "settings" | "logout">;
}> = [
  { title: "Overview", to: "/overview", icon: WorkflowSquare08Icon, shortcut: "overview" },
  { title: "Flows", to: "/flows", icon: Shapes01Icon, shortcut: "flows" },
  { title: "Store", to: "/store", icon: Archive02Icon, shortcut: "store" },
  {
    title: "Observability",
    to: "/observability",
    icon: ChartAnalysisIcon,
    shortcut: "observability",
  },
  { title: "Vault", to: "/vault", icon: AccessIcon, shortcut: "vault" },
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
 * @param props - Sidebar props plus footer actions
 */
export function AppSidebar({
  onFast,
  onSettings,
  onLogout,
  ...props
}: ComponentProps<typeof Sidebar> & {
  readonly onFast: () => void;
  readonly onSettings: () => void;
  readonly onLogout: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const memory = useLastModuleSearch();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="h-10 justify-center border-b border-border/60 p-0">
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
                  tooltip={{
                    children: (
                      <ShortcutTipLabel label={item.title} keys={consoleShortcut(item.shortcut)} />
                    ),
                  }}
                  className={NAV_ITEM_CLASS}
                >
                  <HugeiconsIcon icon={item.icon} />
                  <span className="sr-only">{item.title}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-border/60 p-0">
        <NavFooter onFast={onFast} onSettings={onSettings} onLogout={onLogout} />
      </SidebarFooter>
    </Sidebar>
  );
}
