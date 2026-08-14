/**
 * Theme toggle — light / dark / system with Motion sliding pill.
 * Selected segment shows its label; unselected segments are icon-only + instant tooltip.
 */

import { ComputerIcon, Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "@/lib/motion";
import { useTheme, type Theme } from "@/components/theme-provider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const options: ReadonlyArray<{
  value: Theme;
  label: string;
  icon: typeof Sun03Icon;
}> = [
  { value: "light", label: "Light", icon: Sun03Icon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
  { value: "system", label: "System", icon: ComputerIcon },
];

const spring = { type: "spring" as const, stiffness: 520, damping: 36, mass: 0.7 };

/**
 * Segmented control that sets the Console theme preference.
 * Active segment uses a shared `layoutId` pill that slides between options.
 *
 * @returns Theme toggle group for Console chrome
 */
export function ModeToggle() {
  const { theme, setTheme } = useTheme();
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion ? { duration: 0 } : spring;

  return (
    <LayoutGroup id="oke-console-theme">
      <div
        role="group"
        aria-label="Theme"
        className="flex w-fit flex-row items-center gap-0.5 rounded-full bg-muted/50 p-1"
      >
        {options.map((option) => {
          const active = theme === option.value;
          return (
            <Tooltip key={option.value} disabled={active}>
              <TooltipTrigger
                render={(props) => (
                  <button
                    {...props}
                    type="button"
                    aria-label={option.label}
                    aria-pressed={active}
                    onClick={(event) => {
                      props.onClick?.(event);
                      setTheme(option.value);
                    }}
                    className={cn(
                      "relative inline-flex h-7 min-w-7 items-center justify-center gap-1.5 overflow-hidden rounded-full px-2.5 text-xs font-medium whitespace-nowrap outline-none select-none transition-transform active:scale-95",
                      "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                      props.className,
                    )}
                  >
                    {active ? (
                      <motion.span
                        layoutId="oke-console-theme-pill"
                        className="absolute inset-0 z-0 bg-background shadow-sm"
                        style={{ borderRadius: 9999 }}
                        transition={transition}
                      />
                    ) : null}
                    <span className="relative z-10 inline-flex items-center gap-1.5">
                      <HugeiconsIcon
                        icon={option.icon}
                        size={14}
                        color="currentColor"
                        strokeWidth={1.5}
                        aria-hidden
                      />
                      <AnimatePresence initial={false} mode="popLayout">
                        {active ? (
                          <motion.span
                            key="label"
                            initial={reduceMotion ? false : { opacity: 0, width: 0 }}
                            animate={{ opacity: 1, width: "auto" }}
                            exit={reduceMotion ? undefined : { opacity: 0, width: 0 }}
                            transition={transition}
                            className="overflow-hidden"
                            aria-hidden
                          >
                            {option.label}
                          </motion.span>
                        ) : null}
                      </AnimatePresence>
                    </span>
                  </button>
                )}
              />
              <TooltipContent side="top" sideOffset={6}>
                {option.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
