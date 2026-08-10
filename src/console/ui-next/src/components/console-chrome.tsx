/**
 * Shell-level chrome — logo top, main center, footer theme + version.
 * Layout pattern for auth/setup surfaces; reusable on later pages.
 */

import { CubeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import { ModeToggle } from "@/components/mode-toggle";
import { OkeLogo } from "@/components/oke-logo";

type ConsoleChromeProps = {
  /** Page body (centered in the main column). */
  children?: ReactNode;
};

/**
 * Auth/setup column: logo → main → footer (theme + version).
 *
 * @param props - Optional children for the main region
 */
export function ConsoleChrome({ children }: ConsoleChromeProps) {
  return (
    <div className="min-h-dvh w-full bg-background">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-4 py-8">
        <header className="flex shrink-0 justify-center pt-2">
          <OkeLogo className="h-8 w-auto" />
        </header>

        <main className="flex flex-1 flex-col justify-center">{children}</main>

        <footer className="grid shrink-0 grid-cols-3 items-center gap-2 pt-2">
          <p className="justify-self-start text-xs font-medium text-muted-foreground">
            OKE | Console
          </p>
          <div className="justify-self-center">
            <ModeToggle />
          </div>
          <p className="inline-flex items-center justify-self-end gap-1.5 text-xs text-muted-foreground tabular-nums">
            <HugeiconsIcon
              icon={CubeIcon}
              size={14}
              color="currentColor"
              strokeWidth={1.5}
              aria-hidden
            />
            <span>v{__OKE_VERSION__}</span>
          </p>
        </footer>
      </div>
    </div>
  );
}
