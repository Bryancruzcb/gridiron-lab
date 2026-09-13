import type { FantasyPlayer, FantasyPos } from "@/data/types";
import type {
  InputIssueCode,
  LineupRules,
  RosterEntry,
  ValidatedInput,
} from "./football/lineup-validation.ts";
import { validateLineupInput, validateRoster } from "./football/lineup-validation.ts";

export type SolverMethod = "exact-dp" | "hill-climb" | "greedy-proj" | "greedy-value";

export type Lineup = {
  /** QB, RB, RB, WR, WR, WR, TE, FLEX, DST; checked by validateRoster. */
  slots: RosterEntry[];
  players: FantasyPlayer[];
  salary: number;
  proj: number;
  remaining: number;
};

export type SolveOk = {
  status: "ok";
  method: SolverMethod;
  /** "proven" = optimal under the requested constraints; anything else is "heuristic". */
  optimality: "proven" | "heuristic";
  lineup: Lineup;
  fallbackReason?: string;
};

export type SolveFailure =
  | { status: "invalid-input"; code: InputIssueCode; message: string }
  | { status: "infeasible"; code: "no-legal-roster"; message: string }
  | {
      status: "error";
      code: "stack-not-proven" | "heuristic-no-lineup" | "reconstruction-failed" | "illegal-lineup" | "solver-limit";
      message: string;
    };

export type SolveResult = SolveOk | SolveFailure;

export type SolveRequest = LineupRules & { players: readonly FantasyPlayer[]; method: SolverMethod };

export type OptimizeRequest = LineupRules & { players: readonly FantasyPlayer[] };

/** Projection sums closer than this count as a tie. */
const SCORE_EPS = 1e-9;

/** Upper bound on the exact solver's take-decision bitset (players x states x salary cells). */
const MAX_DECISION_BYTES = 64 * 1024 * 1024;

function byProj(a: FantasyPlayer, b: FantasyPlayer) {
  return b.proj - a.proj;
}

function byValue(a: FantasyPlayer, b: FantasyPlayer) {
  return b.proj / b.salary - a.proj / a.salary;
}

function hasStack(players: readonly FantasyPlayer[]) {
  const qb = players.find((p) => p.pos === "QB");
  if (!qb) return false;
  return players.some((p) => (p.pos === "WR" || p.pos === "TE") && p.team === qb.team);
}

/** Canonical slot order; within a position higher projection first, then id. FLEX gets the spare. */
function assignSlots(players: readonly FantasyPlayer[]): RosterEntry[] | null {
  if (players.length !== 9) return null;
  const of = (pos: FantasyPos) =>
    players.filter((p) => p.pos === pos).sort((a, b) => b.proj - a.proj || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const [qb, rb, wr, te, dst] = [of("QB"), of("RB"), of("WR"), of("TE"), of("DST")];
  if (qb.length !== 1 || dst.length !== 1 || rb.length < 2 || wr.length < 3 || te.length < 1) return null;
  const flex = [...rb.slice(2), ...wr.slice(3), ...te.slice(1)];
  if (flex.length !== 1) return null;
  return [
    { slot: "QB", player: qb[0]! },
    { slot: "RB", player: rb[0]! },
    { slot: "RB", player: rb[1]! },
    { slot: "WR", player: wr[0]! },
    { slot: "WR", player: wr[1]! },
    { slot: "WR", player: wr[2]! },
    { slot: "TE", player: te[0]! },
    { slot: "FLEX", player: flex[0]! },
    { slot: "DST", player: dst[0]! },
  ];
}

function finalize(
  players: readonly FantasyPlayer[],
  v: ValidatedInput,
  method: SolverMethod,
  optimality: SolveOk["optimality"],
): SolveResult {
  const slots = assignSlots(players);
  if (!slots) {
    return { status: "error", code: "illegal-lineup", message: `${method} returned ${players.length} players that do not form a roster.` };
  }
  const issue = validateRoster(slots, { cap: v.cap, locked: v.lockedIds, excluded: v.excludedIds, requireStack: v.requireStack });
  if (issue) {
    return { status: "error", code: "illegal-lineup", message: `${method} produced an illegal roster (${issue.code}): ${issue.message}` };
  }
  const ordered = slots.map((s) => s.player);
  const salary = ordered.reduce((s, p) => s + p.salary, 0);
  const proj = ordered.reduce((s, p) => s + p.proj, 0);
  return { status: "ok", method, optimality, lineup: { slots, players: ordered, salary, proj, remaining: v.cap - salary } };
}

// ---- Exact DP ------------------------------------------------------------
// State = players taken per position (QB 0-1, DST 0-1, RB 0-3, WR 0-4, TE 0-2, at
// most one position above its base count). Taking a player increments exactly one
// counter, so every state has a unique predecessor for that player and one take
// bit per (player layer, state, salary cell) is enough to rebuild the lineup.

const POS_INDEX: Record<FantasyPos, number> = { QB: 0, DST: 1, RB: 2, WR: 3, TE: 4 };
const POS_MAX = [1, 1, 3, 4, 2];
const STATES = 2 * 2 * 4 * 5 * 3;

function encode(c: number[]) {
  return c[0]! + 2 * (c[1]! + 2 * (c[2]! + 4 * (c[3]! + 5 * c[4]!)));
}

function decode(code: number) {
  const out = [code % 2, 0, 0, 0, 0];
  code = (code - out[0]!) / 2;
  out[1] = code % 2;
  code = (code - out[1]!) / 2;
  out[2] = code % 4;
  code = (code - out[2]!) / 4;
  out[3] = code % 5;
  out[4] = (code - out[3]!) / 5;
  return out;
}

function legalCounts(c: number[]) {
  if (c.some((n, i) => n > POS_MAX[i]!)) return false;
  return Math.max(0, c[2]! - 2) + Math.max(0, c[3]! - 3) + Math.max(0, c[4]! - 1) <= 1;
}

/** NEXT[pos * STATES + s] = state after taking one player of pos, or -1. PREV is its inverse. */
const NEXT = new Int16Array(5 * STATES).fill(-1);
const PREV = new Int16Array(5 * STATES).fill(-1);
const GOALS: number[] = [];
for (let s = 0; s < STATES; s++) {
  const c = decode(s);
  if (!legalCounts(c)) continue;
  if (c[0] === 1 && c[1] === 1 && c[2]! + c[3]! + c[4]! === 7) GOALS.push(s);
  for (let pos = 0; pos < 5; pos++) {
    const n = c.slice();
    n[pos] += 1;
    if (!legalCounts(n)) continue;
    NEXT[pos * STATES + s] = encode(n);
    PREV[pos * STATES + encode(n)] = s;
  }
}

function solveExact(v: ValidatedInput): SolveResult {
  const unit = v.salaryUnit;
  let start = 0;
  let spent = 0;
  for (const p of v.locked) {
    start = start < 0 ? -1 : NEXT[POS_INDEX[p.pos] * STATES + start]!;
    spent += p.salary / unit;
  }
  const budget = v.capUnits - spent;
  if (start < 0 || budget < 0) {
    return { status: "error", code: "illegal-lineup", message: "Validated locks do not fit one roster under the cap." };
  }

  const free = v.eligible.filter((p) => !v.lockedIds.has(p.id) && p.salary / unit <= budget);
  const width = budget + 1;
  const layer = STATES * width;
  if ((free.length * layer) / 8 > MAX_DECISION_BYTES) {
    return {
      status: "error",
      code: "solver-limit",
      message: `Exact DP would need ${Math.ceil((free.length * layer) / 8)} bytes of decisions (limit ${MAX_DECISION_BYTES}).`,
    };
  }

  const take = new Uint8Array(Math.ceil((free.length * layer) / 8));
  let prev = new Float64Array(layer).fill(Number.NEGATIVE_INFINITY);
  let next = new Float64Array(layer);
  prev[start * width] = 0;

  for (let i = 0; i < free.length; i++) {
    const p = free[i]!;
    const cost = p.salary / unit;
    const posBase = POS_INDEX[p.pos] * STATES;
    const layerBit = i * layer;
    next.set(prev);
    for (let s = 0; s < STATES; s++) {
      const ns = NEXT[posBase + s]!;
      if (ns < 0) continue;
      const from = s * width - cost;
      const to = ns * width;
      for (let c = cost; c <= budget; c++) {
        const base = prev[from + c]!;
        if (base === Number.NEGATIVE_INFINITY) continue;
        const cand = base + p.proj;
        // Take only on a strict gain: ties keep the lineup without the later (higher-id) player.
        if (cand > next[to + c]! + SCORE_EPS) {
          next[to + c] = cand;
          const bit = layerBit + to + c;
          take[bit >>> 3] |= 1 << (bit & 7);
        }
      }
    }
    [prev, next] = [next, prev];
  }

  let best = Number.NEGATIVE_INFINITY;
  let state = -1;
  let cell = -1;
  // Lowest salary wins a projection tie.
  for (let c = 0; c <= budget; c++) {
    for (const g of GOALS) {
      const val = prev[g * width + c]!;
      if (val > best + SCORE_EPS) {
        best = val;
        state = g;
        cell = c;
      }
    }
  }
  if (state < 0) {
    return {
      status: "infeasible",
      code: "no-legal-roster",
      message: "No roster satisfies the positions, salary cap, locks and exclusions.",
    };
  }

  const picked: FantasyPlayer[] = [];
  for (let i = free.length - 1; i >= 0; i--) {
    const bit = i * layer + state * width + cell;
    if (((take[bit >>> 3]! >> (bit & 7)) & 1) === 0) continue;
    const p = free[i]!;
    picked.push(p);
    state = PREV[POS_INDEX[p.pos] * STATES + state]!;
    cell -= p.salary / unit;
    if (state < 0 || cell < 0) break;
  }
  // The DP value counts only free players; locks entered as the start state.
  const pickedProj = picked.reduce((s, p) => s + p.proj, 0);
  if (state !== start || cell !== 0 || Math.abs(pickedProj - best) > 1e-6) {
    return {
      status: "error",
      code: "reconstruction-failed",
      message: `Exact DP found a feasible optimum (${best}) but could not rebuild its lineup.`,
    };
  }
  const lineup = [...v.locked, ...picked];
  if (v.requireStack && !hasStack(lineup)) {
    return {
      status: "error",
      code: "stack-not-proven",
      message: "Exact DP does not model the QB stack, and its optimum is not stacked.",
    };
  }
  return finalize(lineup, v, "exact-dp", "proven");
}

// ---- Heuristics ------------------------------------------------------------

type Need = { QB: number; RB: number; WR: number; TE: number; DST: number; FLEX: number };

function emptyNeed(): Need {
  return { QB: 1, RB: 2, WR: 3, TE: 1, DST: 1, FLEX: 1 };
}

function apply(need: Need, p: FantasyPlayer): boolean {
  if (need[p.pos] > 0) {
    need[p.pos] -= 1;
    return true;
  }
  if (p.pos !== "QB" && p.pos !== "DST" && need.FLEX > 0) {
    need.FLEX -= 1;
    return true;
  }
  return false;
}

function filled(need: Need) {
  return Object.values(need).every((n) => n <= 0);
}

function minRemainingCost(need: Need, pool: readonly FantasyPlayer[], used: Set<string>): number {
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

function greedyPick(v: ValidatedInput, by: "proj" | "value"): FantasyPlayer[] | null {
  const pool = v.eligible;
  const need = emptyNeed();
  const chosen: FantasyPlayer[] = [];
  const used = new Set<string>();
  let salary = 0;
  for (const p of v.locked) {
    // A lock that cannot take a roster slot makes the whole request unplaceable.
    if (!apply(need, p)) return null;
    chosen.push(p);
    used.add(p.id);
    salary += p.salary;
  }
  if (salary > v.cap) return null;

  const tryAdd = (p: FantasyPlayer) => {
    if (used.has(p.id)) return false;
    const nextNeed: Need = { ...need };
    if (!apply(nextNeed, p)) return false;
    const nextUsed = new Set(used);
    nextUsed.add(p.id);
    const rest = minRemainingCost(nextNeed, pool, nextUsed);
    if (salary + p.salary + rest > v.cap) return false;
    apply(need, p);
    chosen.push(p);
    used.add(p.id);
    salary += p.salary;
    return true;
  };

  const rank = by === "value" ? byValue : byProj;

  if (v.requireStack && !hasStack(chosen)) {
    const lockedQb = chosen.find((p) => p.pos === "QB");
    const qbs = lockedQb ? [lockedQb] : pool.filter((p) => p.pos === "QB" && !used.has(p.id)).sort(rank);
    const wrte = pool.filter((p) => (p.pos === "WR" || p.pos === "TE") && !used.has(p.id));
    outer: for (const qb of qbs) {
      for (const mate of wrte.filter((p) => p.team === qb.team).sort(rank)) {
        if (used.has(qb.id)) {
          if (tryAdd(mate)) break outer;
          continue;
        }
        const nextNeed: Need = { ...need };
        if (!apply(nextNeed, qb) || !apply(nextNeed, mate)) continue;
        const nextUsed = new Set(used);
        nextUsed.add(qb.id);
        nextUsed.add(mate.id);
        const rest = minRemainingCost(nextNeed, pool, nextUsed);
        if (salary + qb.salary + mate.salary + rest > v.cap) continue;
        tryAdd(qb);
        tryAdd(mate);
        break outer;
      }
    }
  }

  for (const p of pool.slice().sort(rank)) {
    tryAdd(p);
    if (filled(need)) break;
  }

  if (!filled(need)) return null;
  if (v.requireStack && !hasStack(chosen)) return null;
  return chosen;
}

/** Projection-greedy seed, then one-for-one swaps within a slot. Local max, not the cap optimum. */
function hillClimbPick(v: ValidatedInput): FantasyPlayer[] | null {
  const seed = greedyPick(v, "proj");
  const slotted = seed && assignSlots(seed);
  if (!slotted) return null;

  let current = slotted;
  let proj = current.reduce((s, e) => s + e.player.proj, 0);
  const pool = v.eligible.slice().sort(byProj);

  for (let pass = 0; pass < 8; pass++) {
    let improved = false;
    for (let i = 0; i < current.length; i++) {
      const { slot, player } = current[i]!;
      if (v.lockedIds.has(player.id)) continue;
      const used = new Set(current.map((e) => e.player.id));
      const salary = current.reduce((s, e) => s + e.player.salary, 0);
      let bestProj = proj;
      let bestCand: FantasyPlayer | null = null;
      for (const cand of pool) {
        if (used.has(cand.id)) continue;
        const fits = slot === "FLEX" ? cand.pos === "RB" || cand.pos === "WR" || cand.pos === "TE" : cand.pos === slot;
        if (!fits) continue;
        if (salary - player.salary + cand.salary > v.cap) continue;
        const candProj = proj - player.proj + cand.proj;
        if (candProj <= bestProj + 0.01) continue;
        if (v.requireStack && !hasStack(current.map((e, j) => (j === i ? cand : e.player)))) continue;
        bestProj = candProj;
        bestCand = cand;
      }
      if (bestCand) {
        current = current.map((e, j) => (j === i ? { slot, player: bestCand } : e));
        proj = bestProj;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return current.map((e) => e.player);
}

function heuristic(v: ValidatedInput, method: Exclude<SolverMethod, "exact-dp">, picked: FantasyPlayer[] | null): SolveResult {
  if (!picked) {
    return {
      status: "error",
      code: "heuristic-no-lineup",
      message: `${method} found no legal lineup${v.requireStack ? " with a QB stack" : ""}. That does not prove none exists.`,
    };
  }
  return finalize(picked, v, method, "heuristic");
}

/** Validates the request, then runs exactly the requested method. No fallback. */
export function solveLineup(request: SolveRequest): SolveResult {
  const checked = validateLineupInput(request.players, request);
  if (!checked.ok) return { status: "invalid-input", ...checked.issue };
  const v = checked.input;
  switch (request.method) {
    case "exact-dp":
      return solveExact(v);
    case "hill-climb":
      return heuristic(v, "hill-climb", hillClimbPick(v));
    case "greedy-proj":
      return heuristic(v, "greedy-proj", greedyPick(v, "proj"));
    case "greedy-value":
      return heuristic(v, "greedy-value", greedyPick(v, "value"));
  }
}

/**
 * Exact DP. With a QB stack the DP optimum is still proven when it happens to be
 * stacked; otherwise hill-climb supplies a stacked lineup labelled heuristic.
 */
export function optimizeLineup(request: OptimizeRequest): SolveResult {
  const exact = solveLineup({ ...request, method: "exact-dp" });
  if (exact.status !== "error" || exact.code !== "stack-not-proven") return exact;
  const climbed = solveLineup({ ...request, method: "hill-climb" });
  if (climbed.status !== "ok") return climbed;
  return {
    ...climbed,
    fallbackReason: "Exact DP does not model the QB stack and its optimum was unstacked, so hill-climb built this stacked lineup.",
  };
}

/** Sums actual points; players without an actual are reported as missing, not scored as zero. */
export function scoreLineup(players: readonly FantasyPlayer[], actuals: ReadonlyMap<string, number>) {
  let pts = 0;
  const missing: string[] = [];
  for (const p of players) {
    const a = actuals.get(p.id);
    if (a == null) missing.push(p.id);
    else pts += a;
  }
  return { pts, n: players.length - missing.length, missing };
}
