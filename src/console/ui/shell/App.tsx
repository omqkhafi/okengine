/**
 * Console shell root — setup gate + routed panels.
 */

import { useQuery } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { consoleCalls, setAccessToken } from "./client.ts";
import { Shell } from "./layout/Shell.tsx";
import { SetupWizard } from "./setup/Wizard.tsx";

/**
 * Root application view — auth gate then shell + outlet.
 */
export function App() {
  const status = useQuery({
    queryKey: ["console.setup.status"],
    queryFn: async () => {
      const res = await consoleCalls.setupStatus();
      if (res.error) {
        if (res.error.code === "Unauthorized") setAccessToken(null);
        throw new Error(res.error.code);
      }
      return res.data as { setupClosed: boolean; claimRequired: boolean };
    },
    retry: 2,
  });

  // Stale tokens after a process restart block nothing useful — clear on claim.
  useEffect(() => {
    if (status.data?.claimRequired) {
      setAccessToken(null);
    }
  }, [status.data?.claimRequired]);

  const me = useQuery({
    queryKey: ["console.session.me"],
    enabled: status.data?.setupClosed === true,
    retry: false,
    queryFn: async () => {
      const res = await consoleCalls.sessionMe();
      if (res.error) {
        if (res.error.code === "Unauthorized" || res.error.code === "AuthFailed") {
          setAccessToken(null);
        }
        throw new Error(res.error.code);
      }
      return res.data;
    },
  });

  if (status.isLoading) {
    return <main className="grid h-full place-items-center text-[var(--oke-muted)]">Loading…</main>;
  }

  if (status.isError) {
    return (
      <main className="grid h-full place-items-center px-6 text-center">
        <div className="flex max-w-md flex-col gap-2">
          <p className="text-[var(--oke-fg)]">Console unreachable</p>
          <p className="text-sm text-[var(--oke-muted)]">
            {status.error instanceof Error
              ? status.error.message
              : "Could not load setup status. Is `oke dev` still running?"}
          </p>
        </div>
      </main>
    );
  }

  if (status.data?.setupClosed && me.isLoading) {
    return <main className="grid h-full place-items-center text-[var(--oke-muted)]">Loading…</main>;
  }

  if (!status.data?.setupClosed || me.isError || !me.data) {
    return (
      <main>
        <SetupWizard />
      </main>
    );
  }

  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}
