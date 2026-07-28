/**
 * Homepage shell layout adapted from better-auth/better-auth `docs/app/page.tsx`
 * under the MIT License. Copyright (c) 2024 - present, Bereket Engida.
 * See site/NOTICE. Brand art, Trusted By, Ask AI, and sign-in demos omitted;
 * the hero visual is the okengine element lattice.
 */

import Link from "next/link";
import { Features } from "@/components/docs/features";
import { Band, BandHeading } from "@/components/landing/band";
import { CodePanel } from "@/components/landing/code-panel";
import { CollapseDiagram } from "@/components/landing/collapse-diagram";
import { ElementLattice } from "@/components/landing/element-lattice";
import { HeroTitle } from "@/components/landing/hero-title";
import { InstallTerminal } from "@/components/landing/install-terminal";
import { ManifestPipeline } from "@/components/landing/manifest-pipeline";
import { Surfaces } from "@/components/landing/surfaces";
import { Vocabulary } from "@/components/landing/vocabulary";
import { POSITIONING } from "@/lib/elements";
import { loadNotesCreateSnippet } from "@/lib/notes-create";

/** Triggers from `docs/get-started/introduction.mdx` — one species, four names. */
const TRIGGERS: ReadonlyArray<{ readonly trigger: string; readonly zoo: string }> = [
  { trigger: 'http.post("/bookings")', zoo: "an API endpoint" },
  { trigger: 'every("10m")', zoo: "a cron job" },
  { trigger: "orderPlaced", zoo: "a queue consumer" },
  { trigger: 'db.table(users).changed("email")', zoo: "a CDC trigger" },
];

const START_HERE: ReadonlyArray<{
  readonly href: string;
  readonly title: string;
  readonly body: string;
}> = [
  {
    href: "/docs/get-started/introduction",
    title: "Introduction",
    body: "One law, ten exports, eight elements.",
  },
  {
    href: "/docs/get-started/installation",
    title: "Installation",
    body: "Scaffold with create-oke and open the Console.",
  },
  {
    href: "/docs/get-started/basic-usage",
    title: "Basic usage",
    body: "Flows, typed client, and bun:test.",
  },
];

export default function HomePage() {
  const createSnippet = loadNotesCreateSnippet();

  return (
    <div id="hero" className="relative text-fd-foreground">
      {/* Clipped: the lattice's decorative grid bleeds past its column padding. */}
      <section className="overflow-x-clip border-b border-fd-border">
        <div className="flex flex-col lg:flex-row">
          <div className="w-full border-b border-fd-border px-5 sm:px-8 lg:w-[44%] lg:border-r lg:border-b-0">
            <HeroTitle />
          </div>
          <div className="flex w-full items-center justify-center px-5 py-12 sm:px-8 lg:w-[56%] lg:py-16">
            <ElementLattice />
          </div>
        </div>
      </section>

      <Band label="readme">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
          <div className="flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-pretty text-fd-muted-foreground sm:text-base">
              {POSITIONING}
            </p>
            <p className="text-sm leading-relaxed text-pretty text-fd-muted-foreground sm:text-base">
              All world access goes through <code className="text-fd-foreground">fx</code>. That one
              rule is why effects, cache keys, capability matrices, and traces are inferred instead
              of annotated by hand.
            </p>
          </div>
          <InstallTerminal />
        </div>
      </Band>

      <Band label="why">
        <div className="flex flex-col gap-6">
          <BandHeading title="A backend is not forty tools">
            Router, queue, cron, websockets, cache, secrets, mailer, model calls — the §5 table
            names forty such concerns, each arriving with its own config, client, and failure mode,
            and you own every seam between them. The eight elements exist to collapse that graph.
          </BandHeading>
          <CollapseDiagram />
        </div>
      </Band>

      <Band label="the law">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-12">
          <div className="flex flex-col gap-6">
            <BandHeading title="Every backend behavior is a Flow">
              There are no separate species called endpoints, handlers, consumers, jobs, or
              workflows. There is one species — and triggers are typed values.
            </BandHeading>
            <dl className="flex flex-col divide-y divide-fd-border border-y border-fd-border">
              {TRIGGERS.map((item) => (
                <div
                  key={item.trigger}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5"
                >
                  <dt className="font-mono text-xs text-fd-foreground">on({item.trigger})</dt>
                  <dd className="text-xs text-fd-muted-foreground">{item.zoo}</dd>
                </div>
              ))}
            </dl>
          </div>

          <CodePanel
            code={createSnippet}
            title="examples/notes/src/flows/notes/index.ts"
            footer="Effects are inferred from what the body touches through fx — here, writes[sql:notes]."
          />
        </div>
      </Band>

      <Band label="elements">
        <div className="flex flex-col gap-6">
          <BandHeading title="Eight elements, one closed set">
            An element earns its place only if it has irreducible physics. New infrastructure
            becomes a driver for an existing element — never a ninth element.
          </BandHeading>
          <Features />
        </div>
      </Band>

      <Band label="vocabulary">
        <div className="flex flex-col gap-6">
          <BandHeading title="Ten exports, one import">
            The entire public vocabulary fits on one line. Everything else in the docs is derived
            from these ten names.
          </BandHeading>
          <div className="overflow-x-auto rounded-xl border border-fd-border bg-fd-card px-4 py-3">
            <code className="font-mono text-xs whitespace-nowrap text-fd-foreground sm:text-[13px]">
              import {"{"} on, flow, signal, store, clock, gate, vault, channel, ai, plugin {"}"}{" "}
              from &quot;okengine&quot;;
            </code>
          </div>
          <Vocabulary />
        </div>
      </Band>

      <Band label="manifest">
        <div className="flex flex-col gap-6">
          <BandHeading title="One artifact, many surfaces">
            Code dies and frameworks die, but data formats survive. So the real product is the
            Manifest: a runtime-neutral description of your system, extracted from your TypeScript
            at build time — and everything downstream is derived from it.
          </BandHeading>
          <ManifestPipeline />
        </div>
      </Band>

      <Band label="console">
        <div className="flex flex-col gap-6">
          <BandHeading title="Three surfaces come up together">
            <code className="text-fd-foreground">oke dev</code> starts your app, the Console, and
            the MCP endpoint from the same Manifest. Mnemonic: O·K·E = 6·5·3.
          </BandHeading>
          <Surfaces />
          <p className="text-sm text-fd-muted-foreground">
            The Console is Manifest-derived — flows, contracts, effects, traces, and an architecture
            diagram are already there.{" "}
            <Link
              href="/docs/console/overview"
              className="text-fd-foreground underline decoration-fd-border underline-offset-4 transition-colors hover:decoration-fd-foreground"
            >
              Read the Console docs
            </Link>
            .
          </p>
        </div>
      </Band>

      <Band label="start here">
        <div className="flex flex-col gap-8">
          <BandHeading title="Learning OKE is learning one sentence">
            One law → one mental model → one documentation path → one trace shape → one thing for an
            AI agent to learn.
          </BandHeading>
          <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border sm:grid-cols-3">
            {START_HERE.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="flex h-full flex-col gap-1 bg-fd-card px-5 py-4 transition-colors hover:bg-fd-secondary/40"
                >
                  <span className="text-sm font-medium">{item.title}</span>
                  <span className="text-sm text-fd-muted-foreground">{item.body}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Band>
    </div>
  );
}
