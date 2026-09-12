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

function byValue(a: FantasyPlayer, b: FantasyPlayer) {
  return b.proj / Math.max(b.salary, 1) - a.proj / Math.max(a.salary, 1);
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
  by?: "proj" | "value";
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

  const rank = opts.by === "value" ? byValue : byProj;

  if (opts.requireStack && !hasStack(chosen)) {
    const lockedQb = chosen.find((p) => p.pos === "QB");
    const qbs = lockedQb
      ? [lockedQb]
      : eligiblePool.filter((p) => p.pos === "QB" && !used.has(p.id)).sort(rank);
    const wrte = eligiblePool.filter((p) => (p.pos === "WR" || p.pos === "TE") && !used.has(p.id));
    outer: for (const qb of qbs) {
      for (const mate of wrte.filter((p) => p.team === qb.team).sort(rank)) {
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

  for (const p of eligiblePool.slice().sort(rank)) {
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

/** Pack remaining-slot counts into 0..191. */
function packNeed(n: Need) {
  return n.QB + 2 * (n.RB + 3 * (n.WR + 4 * (n.TE + 2 * (n.DST + 2 * n.FLEX))));
}

function unpackNeed(code: number): Need {
  const QB = code % 2;
  code = (code / 2) | 0;
  const RB = code % 3;
  code = (code / 3) | 0;
  const WR = code % 4;
  code = (code / 4) | 0;
  const TE = code % 2;
  code = (code / 2) | 0;
  const DST = code % 2;
  code = (code / 2) | 0;
  return { QB, RB, WR, TE, DST, FLEX: code % 2 };
}

const NEED_STATES = 192;

function accept(n: Need, p: FantasyPlayer): Need | null {
  const next = { ...n };
  return apply(next, p) ? next : null;
}

/**
 * Exact 0-1 DP over slots × salary ($100 units). Optimal for cap + roster
 * (not the optional QB stack — use hill-climb when that flag is on).
 */
export function exactLineup(opts: {
  players: FantasyPlayer[];
  cap: number;
  locked: Set<string>;
  excluded: Set<string>;
}): Lineup | null {
  const pool = opts.players.filter((p) => !opts.excluded.has(p.id) && !opts.locked.has(p.id));
  const locked = opts.players.filter((p) => opts.locked.has(p.id) && !opts.excluded.has(p.id));
  const need = emptyNeed();
  let spent = 0;
  for (const p of locked) {
    if (!apply(need, p)) return null;
    spent += p.salary;
  }
  if (spent > opts.cap) return null;
  if (filled(need)) return totals(locked, opts.cap);

  const capU = Math.floor((opts.cap - spent) / 100);
  const stride = capU + 1;
  const cells = NEED_STATES * stride;
  const makeBest = () => {
    const a = new Float64Array(cells);
    a.fill(Number.NEGATIVE_INFINITY);
    return a;
  };
  const makeWho = () => {
    const a = new Int16Array(cells);
    a.fill(-1);
    return a;
  };
  const makeFrom = () => {
    const a = new Int32Array(cells);
    a.fill(-1);
    return a;
  };

  let curBest = makeBest();
  let curWho = makeWho();
  let curFrom = makeFrom();
  let nxtBest = makeBest();
  let nxtWho = makeWho();
  let nxtFrom = makeFrom();
  curBest[packNeed(need) * stride + 0] = 0;

  for (let i = 0; i < pool.length; i++) {
    const p = pool[i]!;
    const cost = (p.salary / 100) | 0;
    if (cost > capU || cost <= 0) continue;
    nxtBest.set(curBest);
    nxtWho.set(curWho);
    nxtFrom.set(curFrom);
    for (let s = 0; s < NEED_STATES; s++) {
      const nxt = accept(unpackNeed(s), p);
      if (!nxt) continue;
      const ns = packNeed(nxt);
      for (let sal = cost; sal <= capU; sal++) {
        const from = s * stride + (sal - cost);
        const v = curBest[from]!;
        if (v === Number.NEGATIVE_INFINITY) continue;
        const to = ns * stride + sal;
        const cand = v + p.proj;
        if (cand > nxtBest[to]!) {
          nxtBest[to] = cand;
          nxtWho[to] = i;
          nxtFrom[to] = from;
        }
      }
    }
    const b = curBest;
    curBest = nxtBest;
    nxtBest = b;
    const w = curWho;
    curWho = nxtWho;
    nxtWho = w;
    const f = curFrom;
    curFrom = nxtFrom;
    nxtFrom = f;
  }

  const goal = packNeed({ QB: 0, RB: 0, WR: 0, TE: 0, DST: 0, FLEX: 0 });
  let top = Number.NEGATIVE_INFINITY;
  let at = -1;
  for (let sal = 0; sal <= capU; sal++) {
    const cell = goal * stride + sal;
    if (curBest[cell]! > top) {
      top = curBest[cell]!;
      at = cell;
    }
  }
  if (at < 0 || top === Number.NEGATIVE_INFINITY) return null;

  const picked: FantasyPlayer[] = [...locked];
  const seen = new Set(locked.map((p) => p.id));
  let cell = at;
  while (cell >= 0 && curWho[cell]! >= 0) {
    const p = pool[curWho[cell]!]!;
    if (!seen.has(p.id)) {
      picked.push(p);
      seen.add(p.id);
    }
    cell = curFrom[cell]!;
  }
  const left = emptyNeed();
  for (const p of picked) apply(left, p);
  if (!filled(left)) return null;
  return totals(picked, opts.cap);
}

/** Projection-greedy seed, then one-for-one swaps. Local max, not the cap optimum. */
export function hillClimbLineup(opts: {
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

/** Exact DP unless a QB stack is required (then hill-climb). */
export function optimizeLineup(opts: {
  players: FantasyPlayer[];
  cap: number;
  locked: Set<string>;
  excluded: Set<string>;
  requireStack?: boolean;
}): Lineup | null {
  if (!opts.requireStack) {
    const exact = exactLineup(opts);
    if (exact) return exact;
  }
  return hillClimbLineup(opts);
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
  const flexAt = rest.findIndex((p) => p.pos === "RB" || p.pos === "WR" || p.pos === "TE");
  if (flexAt >= 0) {
    out.push({ slot: "FLEX", player: rest.splice(flexAt, 1)[0]! });
  }
  const dst = rest.find((p) => p.pos === "DST") ?? rest[0];
  if (dst) {
    const i = rest.indexOf(dst);
    if (i >= 0) rest.splice(i, 1);
    out.push({ slot: "DST", player: dst });
  }
  return out;
}

export function scoreLineup(players: FantasyPlayer[], actuals: Map<string, number>) {
  let pts = 0;
  let n = 0;
  for (const p of players) {
    const a = actuals.get(p.id);
    if (a != null) {
      pts += a;
      n += 1;
    }
  }
  return { pts, n };
}
