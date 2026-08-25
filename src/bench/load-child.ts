/**
 * Bench multi-mode entrypoint — argument/usage style of
 * `src/kernel/horizontal-child.ts`.
 *
 * Modes:
 *   serve <port>                       boot the bench load app on 127.0.0.1:<port>;
 *                                      prints a ready line `{ready:true,pid,port}` to stdout.
 *   flood-sse <url> <signal> <count>   open N SSE connections to the live route and hold them.
 *   sustained <url> <concurrency> <durationS> [path]
 *                                      closed-loop HTTP loop against <url><path>.
 *   shutdown-test                      install graceful shutdown; drain on SIGTERM, exit 0.
 *
 * Env: DATABASE_URL + OKE_TEST_REDIS_URL (or REDIS_URL) required by serve.
 */

import { installGracefulShutdown } from "../kernel/graceful-shutdown.ts";

const mode = process.argv[2];

function usage(): never {
  console.error(
    [
      "usage: load-child serve <port>",
      "       load-child flood-sse <url> <signal> <count>",
      "       load-child sustained <url> <concurrency> <durationS> [path]",
      "       load-child shutdown-test",
    ].join("\n"),
  );
  process.exit(2);
}

if (!mode) usage();

if (mode === "serve") {
  // Delegate entirely to load-app.ts so this file stays a thin dispatcher.
  const portArg = Number(process.argv[3] ?? "0");
  if (!Number.isFinite(portArg) || portArg < 0) usage();
  process.argv = [process.argv[0]!, process.argv[1]!, "serve", "bench-a", String(portArg)];
  await import("./load-app.ts");
} else if (mode === "flood-sse") {
  const url = process.argv[3];
  const sig = process.argv[4] ?? "bench-live";
  const count = Number(process.argv[5] ?? "100");
  if (!url) usage();
  const target = `${url}/_oke/live/${encodeURIComponent(sig)}`;
  console.log(JSON.stringify({ mode, target, count }));
  const controllers: AbortController[] = [];
  const opened = new Set<number>();
  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      (async () => {
        const ac = new AbortController();
        controllers.push(ac);
        try {
          const res = await fetch(target, { signal: ac.signal });
          if (res.body) {
            opened.add(i);
            const reader = res.body.getReader();
            // Hold the connection open, discarding frames.
            for (;;) {
              const { done } = await reader.read();
              if (done) break;
            }
          }
        } catch {
          /* aborted / conn reset — expected during teardown */
        }
      })(),
    ),
  );
  // Only reachable if every connection closed on its own.
  console.log(JSON.stringify({ floodDone: true, opened: opened.size }));
} else if (mode === "sustained") {
  const base = process.argv[3];
  const concurrency = Number(process.argv[4] ?? "50");
  const durationS = Number(process.argv[5] ?? "60");
  const path = process.argv[6] ?? "/ping";
  if (!base) usage();
  const target = `${base}${path}`;
  const deadline = Date.now() + durationS * 1000;
  let requests = 0;
  let errors = 0;
  console.log(JSON.stringify({ mode, target, concurrency, durationS }));
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (Date.now() < deadline) {
        try {
          const res = await fetch(target, { method: path.includes("ping") ? "GET" : "POST" });
          await res.arrayBuffer();
          if (!res.ok) errors++;
        } catch {
          errors++;
        }
        requests++;
      }
    }),
  );
  console.log(JSON.stringify({ sustainedDone: true, requests, errors }));
} else if (mode === "shutdown-test") {
  // Minimal app stub — shutdown-test measures signal handling + exit path,
  // not lease release (no boot result exists in this mode).
  installGracefulShutdown({ app: {} as never, exit: true });
  console.log(JSON.stringify({ ready: true, pid: process.pid, mode: "shutdown-test" }));
  // Hold until SIGTERM/SIGINT; the installed handler drains and exits 0.
  await new Promise(() => {});
} else {
  usage();
}
