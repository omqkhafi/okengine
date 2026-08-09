/**
 * Docker-first `oke dev` vs PGLite `oke test` visual for Installation.
 *
 * Same app on host Bun; Compose for the edit loop, in-process PGLite for tests.
 */

"use client";

import { RevealGroup, RevealItem } from "@/components/docs/reveal";

const MODES: ReadonlyArray<{
  readonly id: string;
  readonly command: string;
  readonly title: string;
  readonly app: string;
  readonly infra: ReadonlyArray<string>;
  readonly bestFor: string;
}> = [
  {
    id: "dev",
    command: "oke dev",
    title: "Dev",
    app: "Host Bun",
    infra: [
      "Postgres / Redis / S3 / SMTP in Compose",
      "Credentials under docker/",
      "Ports unique per project",
    ],
    bestFor: "Edit loop on prod-shaped infra",
  },
  {
    id: "test",
    command: "oke test",
    title: "Test",
    app: "Host Bun",
    infra: ["PGLite (memory://)", "Memory / frozen drivers", "No Compose"],
    bestFor: "Fast bun test with Postgres SQL semantics",
  },
];

/**
 * Side-by-side `oke dev` (Compose) and `oke test` (PGLite) postures.
 */
export function DevModes() {
  return (
    <figure
      className="@container not-prose m-0 w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-fd-border bg-fd-card"
      aria-label="Two postures: oke dev runs the app on host Bun with Postgres, Redis, S3, and SMTP via Compose; oke test uses PGLite and memory drivers without Compose."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-fd-border px-4 py-2.5 sm:px-6">
        <p className="text-sm font-medium text-fd-foreground">Where infra runs</p>
        <code className="font-mono text-[11px] text-fd-muted-foreground">
          app stays on host Bun
        </code>
      </div>

      <RevealGroup
        as="ul"
        className="grid grid-cols-1 gap-px bg-fd-border @min-[32rem]:grid-cols-2"
      >
        {MODES.map((mode) => (
          <RevealItem
            as="li"
            lift
            key={mode.id}
            className="flex min-w-0 flex-col gap-3 bg-fd-card px-4 py-4 transition-colors hover:bg-fd-secondary/40 sm:px-6"
          >
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <p className="text-sm font-medium text-fd-foreground">{mode.title}</p>
              <code className="max-w-full font-mono text-[11px] break-all text-fd-muted-foreground">
                {mode.command}
              </code>
            </div>
            <dl className="flex flex-col gap-2 text-xs">
              <div className="flex min-w-0 gap-3">
                <dt className="w-14 shrink-0 font-mono tracking-[0.12em] text-fd-muted-foreground/70 uppercase">
                  App
                </dt>
                <dd className="min-w-0 text-fd-foreground">{mode.app}</dd>
              </div>
              <div className="flex min-w-0 gap-3">
                <dt className="w-14 shrink-0 font-mono tracking-[0.12em] text-fd-muted-foreground/70 uppercase">
                  Infra
                </dt>
                <dd className="min-w-0">
                  <ul className="flex flex-col gap-1 text-fd-muted-foreground">
                    {mode.infra.map((line) => (
                      <li key={line} className="break-words">
                        {line}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div className="flex min-w-0 gap-3">
                <dt className="w-14 shrink-0 font-mono tracking-[0.12em] text-fd-muted-foreground/70 uppercase">
                  Best
                </dt>
                <dd className="min-w-0 text-pretty text-fd-foreground">{mode.bestFor}</dd>
              </div>
            </dl>
          </RevealItem>
        ))}
      </RevealGroup>
    </figure>
  );
}
