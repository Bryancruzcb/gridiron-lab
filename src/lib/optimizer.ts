import type { FantasyPlayer, FantasyPos } from "@/data/types";

export type Lineup = {
  players: FantasyPlayer[];
  salary: number;
  proj: number;
  remaining: number;
};

type Need = { QB: number; RB: number; WR: number; TE: number; DST: number; FLEX: number };

function emptyNeed(): Need {
  return { QB: 1, RB: 2, WR: 3, TE: 1, DST: 1, FLEX: 1 };
}

function byProj(a: FantasyPlayer, b: FantasyPlayer) {
  return b.proj - a.proj;
}

function totals(players: FantasyPlayer[], cap: number): Lineup {
  const salary = players.reduce((s, p) => s + p.salary, 0);
  const proj = players.reduce((s, p) => s + p.proj, 0);
  return { players, salary, proj, remaining: cap - salary };
}

function hasStack(players: FantasyPlayer[]) {
  const qb = players.find((p) => p.pos === "QB");
  if (!qb) return false;
  return players.some((p) => (p.pos === "WR" || p.pos === "TE") && p.team === qb.team);
}

function apply(need: Need, p: FantasyPlayer): boolean {
  if (p.pos === "QB" && need.QB > 0) {
    need.QB -= 1;
    return true;
  }
  if (p.pos === "DST" && need.DST > 0) {
    need.DST -= 1;
    return true;
  }
  if (p.pos === "TE" && need.TE > 0) {
    need.TE -= 1;
    return true;
  }
  if (p.pos === "RB" && need.RB > 0) {
    need.RB -= 1;
    return true;
  }
  if (p.pos === "WR" && need.WR > 0) {
    need.WR -= 1;
    return true;
  }
  if ((p.pos === "RB" || p.pos === "WR" || p.pos === "TE") && need.FLEX > 0) {
    need.FLEX -= 1;
    return true;
  }
  return false;
}

function minRemainingCost(need: Need, pool: FantasyPlayer[], used: Set<string>): number {
  const u = new Set(used);
  let cost = 0;
  const take = (pred: (p: FantasyPlayer) => boolean, n: number) => {
    if (n <= 0) return true;
    const cands = pool.filter((p) => pred(p) && !u.has(p.id)).sort((a, b) => a.salary - b.salary);
    if (cands.length < n) return false;
    for (let i = 0; i < n; i++) {
      const c = cands[i]!;
      u.add(c.id);
      cost += c.salary;
    }
    return true;
  };
  const ok =
    take((p) => p.pos === "QB", need.QB) &&
    take((p) => p.pos === "RB", need.RB) &&
    take((p) => p.pos === "WR", need.WR) &&
    take((p) => p.pos === "TE", need.TE) &&
    take((p) => p.pos === "DST", need.DST) &&
    take((p) => p.pos === "RB" || p.pos === "WR" || p.pos === "TE", need.FLEX);
  return ok ? cost : Number.POSITIVE_INFINITY;
}

function filled(need: Need) {
  return Object.values(need).every((n) => n <= 0);
}

export function greedyLineup(opts: {
  players: FantasyPlayer[];
  cap: number;
  locked: Set<string>;
  excluded: Set<string>;
  requireStack?: boolean;
}): Lineup | null {
  const eligiblePool = opts.players.filter((p) => !opts.excluded.has(p.id));
  const locked = eligiblePool.filter((p) => opts.locked.has(p.id));
  const need = emptyNeed();
  const chosen: FantasyPlayer[] = [...locked];
  const used = new Set(chosen.map((p) => p.id));
  let salary = locked.reduce((s, p) => s + p.salary, 0);
  for (const p of locked) apply(need, p);
  if (salary > opts.cap) return null;

  const tryAdd = (p: FantasyPlayer) => {
    if (used.has(p.id)) return false;
    const nextNeed: Need = { ...need };
    if (!apply(nextNeed, p)) return false;
    const nextUsed = new Set(used);
    nextUsed.add(p.id);
    const rest = minRemainingCost(nextNeed, eligiblePool, nextUsed);
    if (salary + p.salary + rest > opts.cap) return false;
    apply(need, p);
    chosen.push(p);
    used.add(p.id);
    salary += p.salary;
    return true;
  };

  if (opts.requireStack && !hasStack(chosen)) {
    const lockedQb = chosen.find((p) => p.pos === "QB");
    const qbs = lockedQb
      ? [lockedQb]
      : eligiblePool.filter((p) => p.pos === "QB" && !used.has(p.id)).sort(byProj);
    const wrte = eligiblePool.filter((p) => (p.pos === "WR" || p.pos === "TE") && !used.has(p.id));
    outer: for (const qb of qbs) {
      for (const mate of wrte.filter((p) => p.team === qb.team).sort(byProj)) {
        if (used.has(qb.id)) {
          if (tryAdd(mate)) break outer;
          continue;
        }
        const nextNeed: Need = { ...need };
        if (!apply(nextNeed, qb)) continue;
        apply(nextNeed, mate);
        const nextUsed = new Set(used);
        nextUsed.add(qb.id);
        nextUsed.add(mate.id);
        const rest = minRemainingCost(nextNeed, eligiblePool, nextUsed);
        if (salary + qb.salary + mate.salary + rest > opts.cap) continue;
        tryAdd(qb);
        tryAdd(mate);
        break outer;
      }
    }
  }

  for (const p of eligiblePool.slice().sort(byProj)) {
    tryAdd(p);
    if (filled(need)) break;
  }

  if (!filled(need)) return null;
  const lineup = totals(chosen, opts.cap);
  if (opts.requireStack && !hasStack(lineup.players)) return null;
  return lineup;
}

function slotOf(p: FantasyPlayer, counts: Record<string, number>): string {
  if (p.pos === "QB" || p.pos === "DST") return p.pos;
  if (p.pos === "RB") {
    if (counts.RB < 2) {
      counts.RB += 1;
      return "RB";
    }
    return "FLEX";
  }
  if (p.pos === "WR") {
    if (counts.WR < 3) {
      counts.WR += 1;
      return "WR";
    }
    return "FLEX";
  }
  if (counts.TE < 1) {
    counts.TE += 1;
    return "TE";
  }
  return "FLEX";
}

function slotEligible(slot: string, p: FantasyPlayer) {
  if (slot === "FLEX") return p.pos === "RB" || p.pos === "WR" || p.pos === "TE";
  return p.pos === slot;
}

/** Projection-greedy seed with leftover-cap check, then hill-climb swaps. */
export function optimizeLineup(opts: {
  players: FantasyPlayer[];
  cap: number;
  locked: Set<string>;
  excluded: Set<string>;
  requireStack?: boolean;
}): Lineup | null {
  const seed = greedyLineup(opts);
  if (!seed) return null;

  let current: Lineup = seed;
  const pool = opts.players.filter((p) => !opts.excluded.has(p.id)).slice().sort(byProj);

  for (let pass = 0; pass < 8; pass++) {
    let improved = false;
    const counts = { RB: 0, WR: 0, TE: 0 };
    const slotted = current.players.map((p) => ({ player: p, slot: slotOf(p, counts) }));
    const used = new Set(current.players.map((p) => p.id));

    for (const { player, slot } of slotted) {
      if (opts.locked.has(player.id) || !used.has(player.id)) continue;
      let best: Lineup = current;
      let bestCand: FantasyPlayer | null = null;
      for (const cand of pool) {
        if (used.has(cand.id)) continue;
        if (!slotEligible(slot, cand)) continue;
        const nextPlayers = current.players.map((p) => (p.id === player.id ? cand : p));
        const next = totals(nextPlayers, opts.cap);
        if (next.salary > opts.cap) continue;
        if (opts.requireStack && !hasStack(next.players)) continue;
        if (next.proj > best.proj + 0.01) {
          best = next;
          bestCand = cand;
        }
      }
      if (bestCand) {
        used.delete(player.id);
        used.add(bestCand.id);
        current = best;
        improved = true;
      }
    }
    if (!improved) break;
  }

  return current;
}

export function orderedLineup(players: FantasyPlayer[]): { slot: string; player: FantasyPlayer }[] {
  const rest = [...players];
  const take = (pos: FantasyPos) => {
    const i = rest.findIndex((p) => p.pos === pos);
    if (i < 0) return null;
    return rest.splice(i, 1)[0] ?? null;
  };
  const out: { slot: string; player: FantasyPlayer }[] = [];
  const qb = take("QB");
  if (qb) out.push({ slot: "QB", player: qb });
  const rb1 = take("RB");
  if (rb1) out.push({ slot: "RB", player: rb1 });
  const rb2 = take("RB");
  if (rb2) out.push({ slot: "RB", player: rb2 });
  const wr1 = take("WR");
  if (wr1) out.push({ slot: "WR", player: wr1 });
  const wr2 = take("WR");
  if (wr2) out.push({ slot: "WR", player: wr2 });
  const wr3 = take("WR");
  if (wr3) out.push({ slot: "WR", player: wr3 });
  const te = take("TE");
  if (te) out.push({ slot: "TE", player: te });
  if (rest[0] && rest[0].pos !== "DST") {
    out.push({ slot: "FLEX", player: rest.shift()! });
  }
  const dst = rest.find((p) => p.pos === "DST") ?? rest[0];
  if (dst) {
    const i = rest.indexOf(dst);
    if (i >= 0) rest.splice(i, 1);
    out.push({ slot: "DST", player: dst });
  }
  return out;
}
