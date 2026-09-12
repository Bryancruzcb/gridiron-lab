// Small numeric helpers for study summaries. Every summary is computed from stored per-week
// records with these functions, so a reader can recompute it.

/** Documented rounding for stored values and summaries (decimal places). */
export const ROUNDING = {
  /** Player projections, stored exactly as the solver received them. */
  projection: 4,
  /** Fantasy points: the ruleset already rounds to hundredths; lineup totals are re-rounded to drop float noise. */
  points: 2,
  /** Means, medians, errors, paired differences and interval bounds in summaries. */
  summary: 3,
} as const;

/** Math.round on the scaled value (halves round up), with -0 folded to 0. */
export function round(x: number, digits: number): number {
  const p = 10 ** digits;
  const r = Math.round(x * p) / p;
  return r === 0 ? 0 : r;
}

export function sum(xs: readonly number[]): number {
  let total = 0;
  for (const x of xs) total += x;
  return total;
}

export function mean(xs: readonly number[]): number | null {
  return xs.length ? sum(xs) / xs.length : null;
}

/** Middle value, or the average of the two middle values. */
export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = (s.length - 1) / 2;
  return (s[Math.floor(m)]! + s[Math.ceil(m)]!) / 2;
}

/** Linear interpolation between order statistics (Hyndman-Fan type 7), q in [0, 1]. */
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) throw new RangeError("quantile of an empty sample");
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/** mulberry32: a tiny seeded PRNG, identical on every platform. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BootstrapInterval = { level: number; low: number; high: number };

/**
 * Percentile bootstrap interval for the mean of paired weekly differences. Each resample draws
 * n weeks with replacement from the stored differences; the generator is re-seeded per call, so
 * every comparison in a run uses the same draws. Needs at least two weeks.
 */
export function bootstrapMeanInterval(
  diffs: readonly number[],
  opts: { resamples: number; seed: number; level: number },
): BootstrapInterval | null {
  const n = diffs.length;
  if (n < 2) return null;
  const rand = mulberry32(opts.seed);
  const means: number[] = [];
  for (let b = 0; b < opts.resamples; b++) {
    let total = 0;
    for (let i = 0; i < n; i++) total += diffs[Math.floor(rand() * n)]!;
    means.push(total / n);
  }
  means.sort((a, b) => a - b);
  const tail = (1 - opts.level) / 2;
  return { level: opts.level, low: quantile(means, tail), high: quantile(means, 1 - tail) };
}
