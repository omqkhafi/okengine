/**
 * Authenticated shell — sidebar-07 scaffold, always icon-collapsed on desktop.
 */

import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import type { SessionOperator } from "@/client.ts";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { consoleCommandItems } from "@/components/shell/command-items.ts";
import { CommandPalette } from "@/components/shell/command-palette.tsx";
import { SettingsDialog } from "@/components/shell/settings-dialog.tsx";
import { useTheme } from "@/components/theme-provider";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { logoutOperator } from "@/features/auth/logout.ts";
import { lastSearchFor, type ConsoleModulePath } from "@/lib/last-module-search.ts";
import { useConsoleShortcuts } from "@/lib/use-console-shortcuts.ts";
import { useLastModuleSearch } from "@/lib/use-last-module-search.ts";
import { cn } from "@/lib/utils";

/**
 * Shell chrome around authenticated panel routes.
 *
 * `/overview`, `/flows`, `/store`, `/vault`, `/access`, and `/observability` render full-bleed
 * (no padding / gap); other sections keep the padded inset. Desktop sidebar
 * stays icon-collapsed; mobile still uses the sheet trigger.
 *
 * @param props - Operator from the session guard
 */
export function ShellLayout({ operator }: { readonly operator: SessionOperator }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const memory = useLastModuleSearch();
  const { setTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const fullBleed =
    pathname === "/overview" ||
    pathname === "/flows" ||
    pathname === "/store" ||
    pathname === "/vault" ||
    pathname === "/access" ||
    pathname === "/observability";

  const logout = useCallback(() => {
    void logoutOperator().then(() => {
      void navigate({ to: "/" });
    });
  }, [navigate]);

  const go = useCallback(
    (path: ConsoleModulePath, search: Record<string, unknown>) => {
      void navigate({ to: path, search: search as never });
    },
    [navigate],
  );

  const commandItems = useMemo(
    () =>
      consoleCommandItems({
        memory,
        go,
        openSettings: () => setSettingsOpen(true),
        logout,
        setTheme,
      }),
    [go, logout, memory, setTheme],
  );

  useConsoleShortcuts({
    enabled: !commandOpen && !settingsOpen,
    go: (path) => go(path, lastSearchFor(memory, path)),
    openSettings: () => setSettingsOpen(true),
    logout,
  });

  return (
    <SidebarProvider
      open={false}
      className={fullBleed ? "h-svh max-h-svh overflow-hidden" : undefined}
    >
      <AppSidebar
        onFast={() => setCommandOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onLogout={logout}
      />
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
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} operator={operator} />
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} items={commandItems} />
    </SidebarProvider>
  );
}
