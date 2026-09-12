// Week-to-week QB efficiency persistence: EPA per attempt and CPOE in week w against week w+1.

import type { QbLagFile, QbLagPoint } from "../../../src/data/types.ts";
import type { PlayerRow, PreparedSeason } from "./prepare.ts";
import { round } from "./stats.ts";

export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]! - mx;
    const y = ys[i]! - my;
    num += x * y;
    dx += x * x;
    dy += y * y;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? null : round(num / den, 3);
}

function epaPerAttempt(r: PlayerRow): number | null {
  const att = r.attempts ?? 0;
  return r.passingEpa != null && att > 0 ? r.passingEpa / att : null;
}

/** Pairs consecutive regular-season weeks with at least minAttempts each; ordered by player id, then week. */
export function qbLag(data: PreparedSeason, minAttempts = 15): QbLagFile {
  const byQb = new Map<string, PlayerRow[]>();
  for (const r of data.players) {
    if (r.position !== "QB") continue;
    const list = byQb.get(r.playerId) ?? [];
    list.push(r);
    byQb.set(r.playerId, list);
  }
  const pairs: QbLagPoint[] = [];
  for (const id of [...byQb.keys()].sort()) {
    const rows = byQb.get(id)!;
    const atWeek = new Map(rows.map((r) => [r.week, r]));
    for (const prev of rows) {
      const epaPrev = epaPerAttempt(prev);
      if ((prev.attempts ?? 0) < minAttempts || epaPrev == null) continue;
      const next = atWeek.get(prev.week + 1);
      const epaNext = next ? epaPerAttempt(next) : null;
      if (!next || (next.attempts ?? 0) < minAttempts || epaNext == null) continue;
      pairs.push({
        id,
        name: next.name,
        team: next.team,
        week: next.week,
        epaPrev: round(epaPrev, 3),
        epaNext: round(epaNext, 3),
        cpoePrev: prev.passingCpoe != null ? round(prev.passingCpoe, 1) : null,
        cpoeNext: next.passingCpoe != null ? round(next.passingCpoe, 1) : null,
        attPrev: prev.attempts ?? 0,
        attNext: next.attempts ?? 0,
      });
    }
  }
  const withCpoe = pairs.filter((p) => p.cpoePrev != null && p.cpoeNext != null);
  return {
    source: `nflverse player week ${data.season} REG, passing_epa/attempts and passing_cpoe`,
    season: data.season,
    minAttempts,
    n: pairs.length,
    corrEpa: pearson(
      pairs.map((p) => p.epaPrev),
      pairs.map((p) => p.epaNext),
    ),
    corrCpoe: pearson(
      withCpoe.map((p) => p.cpoePrev!),
      withCpoe.map((p) => p.cpoeNext!),
    ),
    pairs,
  };
}
