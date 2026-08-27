/**
 * Background RSS / open-fd sampler for a foreign PID (the served app child).
 *
 * Samples via `ps` / `lsof` best-effort; lsof failure yields fds=0.
 */

export interface RssSample {
  tMs: number;
  rssMb: number;
  fds: number;
}

/**
 * Sample RSS every intervalMs until stopped. Open-fd count via
 * `lsof -p <pid> -Fn | wc -l` best-effort (0 if lsof fails).
 */
export function startSampler(
  pid: number,
  intervalMs = 5000,
): { samples: () => readonly RssSample[]; stop: () => Promise<void> } {
  const samples: RssSample[] = [];
  let alive = true;
  const t0 = performance.now();
  const tick = async () => {
    while (alive) {
      let rssMb = 0;
      let fds = 0;
      try {
        const ps = Bun.spawnSync(["ps", "-o", "rss=", "-p", String(pid)]);
        rssMb = Number(ps.stdout.toString().trim()) / 1024;
        const lf = Bun.spawnSync(["sh", "-c", `lsof -p ${pid} -Fn 2>/dev/null | wc -l`]);
        fds = Number(lf.stdout.toString().trim());
      } catch {
        /* best-effort */
      }
      samples.push({ tMs: Math.round(performance.now() - t0), rssMb, fds });
      await Bun.sleep(intervalMs);
    }
  };
  void tick();
  return {
    samples: () => samples,
    stop: async () => {
      alive = false;
      await Bun.sleep(intervalMs);
    },
  };
}

/** Linear slope MB/min over samples (least squares on last N points). */
export function rssSlopeMbPerMin(samples: readonly RssSample[], windowLast = 12): number {
  const pts = samples.slice(-windowLast).filter((s) => s.rssMb > 0);
  if (pts.length < 2) return 0;
  const n = pts.length;
  const sx = pts.reduce((a, s) => a + s.tMs, 0);
  const sy = pts.reduce((a, s) => a + s.rssMb, 0);
  const sxy = pts.reduce((a, s) => a + s.tMs * s.rssMb, 0);
  const sxx = pts.reduce((a, s) => a + s.tMs * s.tMs, 0);
  const slopePerMs = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  return Number((slopePerMs * 60_000).toFixed(2));
}
