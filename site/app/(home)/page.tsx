/**
 * Homepage shell layout adapted from better-auth/better-auth `docs/app/page.tsx`
 * under the MIT License. Copyright (c) 2024 - present, Bereket Engida.
 * See site/NOTICE. Brand art, Trusted By, Ask AI, and sign-in demos omitted;
 * the hero visual is the okengine isometric element lattice.
 */

import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Features } from "@/components/docs/features";
import { AiOnboardButton } from "@/components/landing/ai-onboard-button";
import { Band, BandHeading } from "@/components/landing/band";
import { BudgetsGraph } from "@/components/landing/budgets-graph";
import { CodePanel } from "@/components/landing/code-panel";
import { CollapseDiagram } from "@/components/landing/collapse-diagram";
import { ElementLattice } from "@/components/landing/element-lattice";
import { FlowSimulator, TriggerList } from "@/components/landing/flow-simulator";
import { HeroTitle } from "@/components/landing/hero-title";
import { InstallTerminal } from "@/components/landing/install-terminal";
import { ManifestPipeline } from "@/components/landing/manifest-pipeline";
import { ProofStrip } from "@/components/landing/proof-strip";
import { Reveal } from "@/components/landing/reveal";
import { Surfaces } from "@/components/landing/surfaces";
import { BuiltWithStrip, WorksWithStrip } from "@/components/landing/trust-strip";
import { Vocabulary } from "@/components/landing/vocabulary";
import { POSITIONING } from "@/lib/elements";
import { loadStarterFlowSnippet } from "@/lib/starter-flow";

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
  const starterSnippet = loadStarterFlowSnippet();

  return (
    <div id="hero" className="relative text-fd-foreground">
      {/* Clipped: the lattice's decorative grid bleeds past its column padding. */}
      <section className="overflow-x-clip border-b border-fd-border">
        <div className="flex flex-col lg:flex-row">
          <div className="w-full border-b border-fd-border px-5 sm:px-8 lg:w-[44%] lg:border-r lg:border-b-0">
            <HeroTitle />
          </div>
          <div className="flex w-full items-end justify-center px-5 pt-10 pb-14 sm:px-8 sm:pt-12 sm:pb-16 lg:w-[56%] lg:pt-14 lg:pb-20">
            <ElementLattice />
          </div>
        </div>
      </section>

      <Band label="readme">
        <div className="flex flex-col gap-10 lg:gap-12">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
            <Reveal>
              <div className="flex h-full flex-col justify-center gap-4">
                <p className="text-sm leading-relaxed text-pretty text-fd-muted-foreground sm:text-base">
                  {POSITIONING}
                </p>
                <p className="text-sm leading-relaxed text-pretty text-fd-muted-foreground sm:text-base">
                  All world access goes through <code className="text-fd-foreground">fx</code>. That
                  one rule is why effects, cache keys, capability matrices, and traces are inferred
                  instead of annotated by hand.
                </p>
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <InstallTerminal />
            </Reveal>
          </div>
          <Reveal delay={0.05} className="border-t border-fd-border pt-8 lg:pt-10">
            <ProofStrip />
          </Reveal>
        </div>
      </Band>

      <Band label="stack">
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">
          <div className="flex min-w-0 flex-col gap-3">
            <span className="font-mono text-[11px] tracking-[0.16em] text-fd-muted-foreground uppercase">
              Built with
            </span>
            <Reveal>
              <BuiltWithStrip />
            </Reveal>
          </div>
          <div className="flex min-w-0 flex-col gap-3 border-t border-fd-border pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10">
            <span className="font-mono text-[11px] tracking-[0.16em] text-fd-muted-foreground uppercase">
              Works with
            </span>
            <Reveal delay={0.05}>
              <WorksWithStrip />
            </Reveal>
          </div>
        </div>
      </Band>

      <Band label="why">
        <div className="flex flex-col gap-6">
          <Reveal>
            <BandHeading title="A backend is not forty tools">
              Router, queue, cron, websockets, cache, secrets, mailer, model calls — the §5 table
              names forty such concerns, each arriving with its own config, client, and failure
              mode, and you own every seam between them. The eight elements exist to collapse that
              graph.
            </BandHeading>
          </Reveal>
          <Reveal delay={0.05}>
            <CollapseDiagram />
          </Reveal>
        </div>
      </Band>

      <Band label="the law">
        <div className="flex flex-col gap-8 lg:gap-10">
          <Reveal>
            <BandHeading title="Every backend behavior is a Flow">
              There are no separate species called endpoints, handlers, consumers, jobs, or
              workflows. There is one species — and triggers are typed values.
            </BandHeading>
          </Reveal>

          <div className="grid items-stretch gap-4 lg:grid-cols-2 lg:gap-5">
            <Reveal delay={0.05} className="min-h-0 lg:h-full">
              <div className="lg:hidden">
                <TriggerList />
              </div>
              <div className="hidden h-full min-h-[22rem] lg:block">
                <FlowSimulator />
              </div>
            </Reveal>
            <Reveal delay={0.08} className="min-h-0 lg:h-full">
              <CodePanel
                code={starterSnippet}
                title="src/flows/main/index.ts"
                footer="The standard starter is ordinary application code — no hidden runtime species."
              />
            </Reveal>
          </div>
        </div>
      </Band>

      <Band label="elements">
        <div className="flex flex-col gap-6">
          <Reveal>
            <BandHeading title="Eight elements, one closed set">
              An element earns its place only if it has irreducible physics. New infrastructure
              becomes a driver for an existing element — never a ninth element.
            </BandHeading>
          </Reveal>
          <Reveal delay={0.05}>
            <Features />
          </Reveal>
        </div>
      </Band>

      <Band label="vocabulary">
        <div className="flex flex-col gap-6">
          <Reveal>
            <BandHeading title="Ten exports, one import">
              The entire public vocabulary fits on one line. Everything else in the docs is derived
              from these ten names.
            </BandHeading>
          </Reveal>
          <Reveal delay={0.05}>
            <div className="overflow-x-auto rounded-xl border border-fd-border bg-fd-card px-4 py-3">
              <code className="font-mono text-xs whitespace-nowrap text-fd-foreground sm:text-[13px]">
                import {"{"} on, flow, signal, store, clock, gate, vault, channel, ai, plugin {"}"}{" "}
                from &quot;okengine&quot;;
              </code>
            </div>
          </Reveal>
          <Vocabulary />
        </div>
      </Band>

      <Band label="budgets">
        <div className="flex flex-col gap-6">
          <Reveal>
            <BandHeading title="Measured, not marketed">
              Four hard caps CI fails on — kernel, client, cold start, routing — then{" "}
              <code className="text-fd-foreground">okengine</code> and{" "}
              <code className="text-fd-foreground">okengine/plugins</code> as baselines (expand for
              leaf entrypoints and per-plugin sizes by category). Every figure is from{" "}
              <code className="text-fd-foreground">budgets.json</code>.
            </BandHeading>
          </Reveal>
          <Reveal delay={0.05}>
            <BudgetsGraph />
          </Reveal>
        </div>
      </Band>

      <Band label="manifest">
        <div className="flex flex-col gap-6">
          <Reveal>
            <BandHeading title="One artifact, many surfaces">
              Code dies and frameworks die, but data formats survive. So the real product is the
              Manifest: a runtime-neutral description of your system, extracted from your TypeScript
              at build time — and everything downstream is derived from it.
            </BandHeading>
          </Reveal>
          <Reveal delay={0.05}>
            <ManifestPipeline />
          </Reveal>
        </div>
      </Band>

      <Band label="console">
        <div className="flex flex-col gap-6">
          <Reveal>
            <BandHeading title="Four surfaces come up together">
              <code className="text-fd-foreground">oke dev</code> starts your app, the Console,
              runtime MCP, and docs MCP. Mnemonic: O·K·E = 6·5·3.
            </BandHeading>
          </Reveal>
          <Surfaces />
          <Reveal delay={0.05}>
            <p className="text-sm text-fd-muted-foreground">
              The Console is Manifest-derived — flows, contracts, effects, traces, and an
              architecture diagram are already there.
            </p>
          </Reveal>
        </div>
      </Band>

      <Band label="start here">
        <div className="flex flex-col gap-8">
          <Reveal>
            <BandHeading title="Learning OKE is learning one sentence">
              One law → one mental model → one documentation path → one trace shape → one thing for
              an AI agent to learn.
            </BandHeading>
          </Reveal>
          <Reveal delay={0.05}>
            <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border sm:grid-cols-3">
              {START_HERE.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="group flex h-full flex-col gap-1 bg-fd-card px-5 py-4 transition-colors hover:bg-fd-secondary/40"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{item.title}</span>
                      <ArrowUpRight
                        aria-hidden
                        className="size-3.5 translate-x-1 translate-y-1 text-fd-muted-foreground opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100"
                      />
                    </span>
                    <span className="text-sm text-fd-muted-foreground">{item.body}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </Band>

      <Band label="ship">
        <Reveal>
          <div className="relative overflow-hidden rounded-xl border border-fd-border px-6 py-12 sm:px-10 sm:py-16">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-grid-black/[0.02] dark:bg-grid-white/[0.02]"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 -right-16 size-[26rem] rounded-full bg-fd-foreground/[0.03] blur-3xl dark:bg-fd-foreground/[0.045]"
            />
            <div className="relative z-[1] flex flex-col gap-6">
              <p className="font-mono text-[11px] tracking-[0.12em] text-fd-muted-foreground uppercase">
                <span className="select-none">$ </span>bunx create-oke@latest my-app
              </p>
              <h2 className="max-w-[22ch] text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                Scaffold, run, open the Console
              </h2>
              <p className="max-w-xl text-sm leading-relaxed text-pretty text-fd-muted-foreground sm:text-base">
                One law, eight elements, ten exports. The Manifest, typed client, and MCP surface
                come with the starter — nothing to wire by hand.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  href="/docs/get-started/installation"
                  className="group inline-flex items-center bg-fd-foreground px-5 py-2.5 text-sm font-medium text-fd-background transition-opacity hover:opacity-90"
                >
                  Get started
                  <ArrowRight
                    aria-hidden
                    className="ml-2 size-3.5 transition-transform duration-300 group-hover:translate-x-0.5"
                  />
                </Link>
                <AiOnboardButton />
              </div>
            </div>
          </div>
        </Reveal>
      </Band>
    </div>
  );
}
