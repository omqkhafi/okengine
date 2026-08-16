/**
 * Auth/setup frame — wordmark docked to the lock, Console strip at the foot.
 */

import { CubeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { EXPLORER_COUNT_CLASS } from "@/components/explorer/explorer-chrome.ts";
import { ModeToggle } from "@/components/mode-toggle";
import { OkeLogo } from "@/components/oke-logo";

type ConsoleChromeProps = {
  /** Page body (centered in the main column). */
  children?: ReactNode;
};

/**
 * Gate column: wordmark docked to the lock, footer strip (theme + version).
 *
 * @param props - Optional children for the main region
 */
export function ConsoleChrome({ children }: ConsoleChromeProps) {
  return (
    <div className="flex min-h-dvh w-full flex-col bg-background" data-slot="console-chrome">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
        <div className="flex flex-col items-stretch gap-10">
          <OkeLogo className="h-7 w-auto self-center" />
          {children}
        </div>
      </main>

      <footer className="grid h-10 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch border-t border-border/60">
        <p className="flex min-w-0 items-center truncate px-2 text-[10px] font-medium text-muted-foreground">
          OKE | Console
        </p>
        <ModeToggle />
        <p className={`${EXPLORER_COUNT_CLASS} flex min-w-0 items-center justify-end gap-1.5 px-2`}>
          <HugeiconsIcon
            icon={CubeIcon}
            size={12}
            color="currentColor"
            strokeWidth={1.5}
            aria-hidden
          />
          <span>v{__OKE_VERSION__}</span>
        </p>
      </footer>
    </div>
  );
}
