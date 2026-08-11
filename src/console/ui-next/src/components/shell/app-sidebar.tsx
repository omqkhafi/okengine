/**
 * Authenticated Console sidebar — sidebar-07 layout, Flows / Units / Store.
 */

import { Folder01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useState, type ComponentProps, type FocusEvent } from "react";
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
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import type { SessionOperator } from "@/client.ts";
import { ELEMENT_ICONS } from "@/lib/element-icons.ts";
import { AnimatePresence, motion, useReducedMotion } from "@/lib/motion";

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

const spring = { type: "spring" as const, stiffness: 520, damping: 36, mass: 0.7 };

/**
 * Sidebar header brand — expanded: wordmark + end trigger; collapsed: icon↔trigger on hover.
 */
function SidebarBrand() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const [hovered, setHovered] = useState(false);
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion ? { duration: 0 } : spring;
  const showCollapsedTrigger = hovered;

  const clearHoverIfLeft = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setHovered(false);
  };

  return (
    <div
      className="flex w-full items-center justify-between gap-2 px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={clearHoverIfLeft}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {collapsed ? (
          <motion.div
            key="collapsed"
            className="relative size-7 shrink-0"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0, scale: 0.85 }}
            transition={transition}
          >
            <AnimatePresence initial={false}>
              {showCollapsedTrigger ? (
                <motion.div
                  key="trigger"
                  className="absolute inset-0 flex items-center justify-center"
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.75, rotate: -12 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, scale: 0.75, rotate: 12 }}
                  transition={transition}
                >
                  <SidebarTrigger />
                </motion.div>
              ) : (
                <motion.div
                  key="logo-icon"
                  className="absolute inset-0 flex items-center justify-center"
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.75, rotate: 12 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  exit={reduceMotion ? undefined : { opacity: 0, scale: 0.75, rotate: -12 }}
                  transition={transition}
                >
                  <OkeLogoIcon className="size-5" />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div
            key="expanded"
            className="flex w-full items-center justify-between gap-2"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={transition}
          >
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={transition}
            >
              <OkeLogo className="h-5 w-auto shrink-0" />
            </motion.div>
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, x: 8, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              transition={transition}
            >
              <SidebarTrigger />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

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
        <SidebarBrand />
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
