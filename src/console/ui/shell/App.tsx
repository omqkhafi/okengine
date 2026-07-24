/**
 * Console shell root — setup gate + routed panels.
 */

import { useQuery } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { consoleCalls } from "./client.ts";
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
      if (res.error) throw new Error(res.error.code);
      return res.data as { setupClosed: boolean };
    },
  });

  const me = useQuery({
    queryKey: ["console.session.me"],
    enabled: status.data?.setupClosed === true,
    retry: false,
    queryFn: async () => {
      const res = await consoleCalls.sessionMe();
      if (res.error) throw new Error(res.error.code);
      return res.data;
    },
  });

  if (status.isLoading) {
    return (
      <main className="grid h-full place-items-center text-[var(--oke-muted)]">
        Loading…
      </main>
    );
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
