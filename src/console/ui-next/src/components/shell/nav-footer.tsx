/**
 * Sidebar footer — Fast (command palette), Settings, Logout.
 */

import { CommandIcon, Logout03Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { JSX } from "react";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { ShortcutTipLabel } from "@/lib/shortcut-keys.tsx";
import { consoleShortcut } from "@/lib/shortcut.ts";
import { cn } from "@/lib/utils.ts";

const FOOTER_ITEM_CLASS =
  "rounded-none! justify-center data-active:bg-muted/70! data-active:text-foreground group-data-[collapsible=icon]:h-10! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:p-0!";

/** Props for {@link NavFooter}. */
export interface NavFooterProps {
  readonly onFast: () => void;
  readonly onSettings: () => void;
  readonly onLogout: () => void;
}

/**
 * Icon-only footer actions for the always-collapsed sidebar.
 *
 * @param props - Fast / Settings / Logout handlers
 */
export function NavFooter({ onFast, onSettings, onLogout }: NavFooterProps): JSX.Element {
  const { isMobile, setOpenMobile } = useSidebar();
  const closeMobile = (): void => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <SidebarMenu className="items-stretch gap-0">
      <FooterItem
        label="Fast"
        keys={consoleShortcut("fast")}
        icon={CommandIcon}
        slot="sidebar-fast"
        onClick={() => {
          closeMobile();
          onFast();
        }}
      />
      <FooterItem
        label="Settings"
        keys={consoleShortcut("settings")}
        icon={Settings01Icon}
        slot="sidebar-settings"
        onClick={() => {
          closeMobile();
          onSettings();
        }}
      />
      <FooterItem
        label="Logout"
        keys={consoleShortcut("logout")}
        icon={Logout03Icon}
        slot="sidebar-logout"
        danger
        onClick={() => {
          closeMobile();
          onLogout();
        }}
      />
    </SidebarMenu>
  );
}

function FooterItem({
  label,
  keys,
  icon,
  slot,
  danger,
  onClick,
}: {
  readonly label: string;
  readonly keys?: readonly string[];
  readonly icon: typeof CommandIcon;
  readonly slot: string;
  readonly danger?: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <SidebarMenuItem className="w-full">
      <SidebarMenuButton
        tooltip={keys ? { children: <ShortcutTipLabel label={label} keys={keys} /> } : label}
        onClick={onClick}
        data-slot={slot}
        className={cn(
          FOOTER_ITEM_CLASS,
          danger
            ? "hover:bg-destructive/10! hover:text-destructive"
            : "hover:bg-muted/50! hover:text-foreground",
        )}
      >
        <HugeiconsIcon icon={icon} />
        <span className="sr-only">{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
