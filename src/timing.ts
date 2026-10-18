// Rolling timings for the debug panel: how long something took, over the last
// second. Pure (the caller passes the clock), so it is unit-testable.

/** The window: the last second. */
const WINDOW_MS = 1000;

export interface TimingStats {
  /** Mean duration over the window, ms. */
  avg: number;
  /** Longest duration in the window, ms. */
  max: number;
  /** Total time spent per second of wall clock, ms (= share of the main thread × 1000). */
  perSecond: number;
  /** Samples in the window. */
  count: number;
}

export class RollingTiming {
  private times: number[] = [];
  private durations: number[] = [];

  /** Records a duration (ms) that ended at `now` (ms, e.g. performance.now()). */
  add(now: number, ms: number): void {
    this.times.push(now);
    this.durations.push(ms);
    this.prune(now);
  }

  stats(now: number): TimingStats {
    this.prune(now);
    const n = this.durations.length;
    if (!n) return { avg: 0, max: 0, perSecond: 0, count: 0 };
    let sum = 0;
    let max = 0;
    for (const d of this.durations) {
      sum += d;
      if (d > max) max = d;
    }
    return { avg: sum / n, max, perSecond: (sum * 1000) / WINDOW_MS, count: n };
  }

  private prune(now: number): void {
    let drop = 0;
    while (drop < this.times.length && now - this.times[drop] > WINDOW_MS) drop++;
    if (drop) {
      this.times.splice(0, drop);
      this.durations.splice(0, drop);
    }
  }
}

/** "4.2 / 11.0 ms" (avg / max), or "–" without samples. */
export function formatTiming(s: TimingStats): string {
  return s.count ? `${s.avg.toFixed(1)} / ${s.max.toFixed(1)} ms` : "–";
}

/** One row of the perf log: column → value. */
export type PerfRow = Record<string, string | number>;

/** Rows as CSV, with the columns of the first row (values are numbers or plain words, no quoting needed). */
export function perfCsv(rows: readonly PerfRow[]): string {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  const lines = rows.map((r) => columns.map((c) => String(r[c] ?? "").replace(/[,\n]/g, " ")).join(","));
  return [columns.join(","), ...lines].join("\n") + "\n";
}
