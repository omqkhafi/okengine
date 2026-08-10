/**
 * Sidebar footer — real operator Avatar (initials fallback, no fake image URL).
 */

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { SessionOperator } from "@/client.ts";

/**
 * Initials for the operator Avatar fallback.
 *
 * @param name - Display name
 */
function operatorInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${second}`.toUpperCase() || "?";
}

/**
 * Operator identity in the sidebar footer.
 *
 * @param props - Signed-in operator from claim/login/`session/me`
 */
export function NavUser({ operator }: { readonly operator: SessionOperator }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          size="lg"
          tooltip={operator.email}
          className="cursor-default hover:bg-transparent active:bg-transparent data-open:hover:bg-transparent group-data-[collapsible=icon]:rounded-full"
        >
          <Avatar data-slot="operator-avatar">
            <AvatarFallback aria-hidden>{operatorInitials(operator.name)}</AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{operator.name}</span>
            <span className="truncate text-xs">{operator.email}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
