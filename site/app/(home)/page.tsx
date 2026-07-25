import Link from 'next/link';
import { Features } from '@/components/docs/features';
import { POSITIONING } from '@/lib/elements';
import { loadNotesCreateSnippet } from '@/lib/notes-create';

export default function HomePage() {
  const createSnippet = loadNotesCreateSnippet();

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-20 px-6 py-16">
      <section className="flex flex-col gap-6">
        <p className="text-sm font-medium tracking-[0.14em] text-fd-muted-foreground uppercase">
          okengine
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          One law. Eight elements. Ten exports.
        </h1>
        <p className="max-w-3xl text-lg text-fd-muted-foreground text-pretty leading-relaxed">
          {POSITIONING}
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link
            href="/docs/get-started/introduction"
            className="rounded-md bg-fd-primary px-4 py-2.5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-90"
          >
            Get started
          </Link>
          <Link
            href="/docs/get-started/basic-usage"
            className="rounded-md border border-fd-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-fd-secondary/50"
          >
            Basic usage
          </Link>
          <Link
            href="/docs/learn/notes"
            className="rounded-md px-4 py-2.5 text-sm font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground"
          >
            Notes walkthrough →
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-wide text-fd-muted-foreground uppercase">
            The law
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">
            Every backend behavior is a Flow
          </h2>
          <p className="max-w-2xl text-fd-muted-foreground">
            Endpoints, jobs, consumers, and workflows are the same species —{' '}
            <code className="text-fd-foreground">on(Trigger) → Effects</code>. Here is
            Notes <code className="text-fd-foreground">create</code> from the example the
            docs gate against.
          </p>
        </div>
        <pre className="overflow-x-auto rounded-xl border border-fd-border bg-fd-secondary/30 p-4 text-sm leading-relaxed">
          <code>{createSnippet}</code>
        </pre>
        <p className="text-sm text-fd-muted-foreground">
          Source:{' '}
          <code className="text-fd-foreground">
            examples/notes/src/flows/notes/index.ts
          </code>
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium tracking-wide text-fd-muted-foreground uppercase">
            Elements
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">Eight elements</h2>
          <p className="max-w-2xl text-fd-muted-foreground">
            Irreducible physics only. New infrastructure is a driver — never a ninth
            element. Click through for each page.
          </p>
        </div>
        <Features />
      </section>

      <section className="flex flex-col gap-4 border-t border-fd-border pt-12">
        <h2 className="text-xl font-semibold tracking-tight">Start here</h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {[
            {
              href: '/docs/get-started/introduction',
              title: 'Introduction',
              body: 'One law, ten exports, eight elements.',
            },
            {
              href: '/docs/get-started/installation',
              title: 'Installation',
              body: 'Scaffold with create-oke and open the Console.',
            },
            {
              href: '/docs/get-started/basic-usage',
              title: 'Basic usage',
              body: 'Flows, typed client, and bun:test.',
            },
          ].map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex h-full flex-col gap-1 rounded-xl border border-fd-border p-4 transition-colors hover:bg-fd-secondary/40"
              >
                <span className="font-medium">{item.title}</span>
                <span className="text-sm text-fd-muted-foreground">{item.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
