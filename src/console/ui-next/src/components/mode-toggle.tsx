/**
 * Theme toggle group — light / dark / system (footer chrome).
 * Matches the shared ToggleGroup pill pattern used on auth surfaces.
 */

import { ComputerIcon, Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTheme, type Theme } from "@/components/theme-provider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const options: ReadonlyArray<{
  value: Theme;
  label: string;
  icon: typeof Sun03Icon;
  showLabel?: boolean;
}> = [
  { value: "light", label: "Light", icon: Sun03Icon },
  { value: "dark", label: "Dark", icon: Moon02Icon },
  { value: "system", label: "System", icon: ComputerIcon, showLabel: true },
];

/**
 * Segmented ToggleGroup that sets the Console theme preference.
 */
export function ModeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <ToggleGroup
      value={[theme]}
      onValueChange={(groupValue) => {
        const next = groupValue[0];
        if (next === "light" || next === "dark" || next === "system") {
          setTheme(next);
        }
      }}
      size="xs"
      spacing={1}
      aria-label="Theme"
      className="gap-0.5 rounded-3xl bg-muted/50 p-0.5 outline-none ring-0"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          aria-label={option.label}
          className="rounded-full"
        >
          <HugeiconsIcon
            icon={option.icon}
            size={14}
            color="currentColor"
            strokeWidth={1.5}
            aria-hidden
          />
          {option.showLabel ? <span>{option.label}</span> : null}
          {!option.showLabel ? <span className="sr-only">{option.label}</span> : null}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
