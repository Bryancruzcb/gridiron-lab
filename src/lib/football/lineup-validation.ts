import type { FantasyPlayer, FantasyPos } from "@/data/types";

/** Classic DraftKings-style roster, in the order every solved lineup is reported. */
export const ROSTER_SLOTS = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX", "DST"] as const;

export type RosterSlot = (typeof ROSTER_SLOTS)[number];

export type RosterEntry = { slot: RosterSlot; player: FantasyPlayer };

export type LineupRules = {
  cap: number;
  locked?: Iterable<string>;
  excluded?: Iterable<string>;
  requireStack?: boolean;
};

/**
 * Salary contract: every salary is a positive integer number of dollars and the
 * cap is finite and positive. Salaries are indexed in their GCD unit, so sums are
 * exact (k units fit the cap iff k <= floor(cap / unit)) and nothing is rounded.
 * The grid floor(cap / unit) may not exceed this bound; the $50k slate in $100
 * steps uses 500 units, $25 steps use 2,000, and $1 steps are rejected.
 */
export const MAX_SALARY_UNITS = 2000;

export type InputIssueCode =
  | "invalid-cap"
  | "duplicate-player-id"
  | "invalid-position"
  | "invalid-salary"
  | "non-finite-projection"
  | "lock-exclude-overlap"
  | "unknown-lock"
  | "incompatible-locks"
  | "locks-over-cap"
  | "insufficient-pool"
  | "salary-precision";

export type RosterIssueCode =
  | "roster-size"
  | "slot-order"
  | "slot-position"
  | "duplicate-player"
  | "over-cap"
  | "missing-lock"
  | "excluded-player"
  | "missing-stack";

export type LineupIssue<Code extends string> = { code: Code; message: string };

/** Solver-ready input: canonical id order, exclusions removed, salary grid known. */
export type ValidatedInput = {
  cap: number;
  eligible: FantasyPlayer[];
  locked: FantasyPlayer[];
  lockedIds: ReadonlySet<string>;
  excludedIds: ReadonlySet<string>;
  requireStack: boolean;
  salaryUnit: number;
  capUnits: number;
};

export type InputValidation =
  | { ok: true; input: ValidatedInput }
  | { ok: false; issue: LineupIssue<InputIssueCode> };

const POSITIONS: readonly FantasyPos[] = ["QB", "RB", "WR", "TE", "DST"];

type PosCounts = Record<FantasyPos, number>;

function countPositions(players: readonly FantasyPlayer[]): PosCounts {
  const counts: PosCounts = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0 };
  for (const p of players) counts[p.pos] += 1;
  return counts;
}

function byId(a: FantasyPlayer, b: FantasyPlayer) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function fail(code: InputIssueCode, message: string): InputValidation {
  return { ok: false, issue: { code, message } };
}

/** Checks everything a solver relies on before any algorithm runs. */
export function validateLineupInput(players: readonly FantasyPlayer[], rules: LineupRules): InputValidation {
  const { cap } = rules;
  if (!Number.isFinite(cap) || cap <= 0) return fail("invalid-cap", `Salary cap must be a finite positive number, got ${cap}.`);

  const known = new Map<string, FantasyPlayer>();
  for (const p of players) {
    if (known.has(p.id)) return fail("duplicate-player-id", `Player id ${p.id} appears more than once in the pool.`);
    known.set(p.id, p);
    if (!POSITIONS.includes(p.pos)) return fail("invalid-position", `Player ${p.id} has unsupported position ${String(p.pos)}.`);
    if (!Number.isSafeInteger(p.salary) || p.salary <= 0)
      return fail("invalid-salary", `Player ${p.id} salary must be a positive whole-dollar amount, got ${p.salary}.`);
    if (!Number.isFinite(p.proj)) return fail("non-finite-projection", `Player ${p.id} projection must be finite, got ${p.proj}.`);
  }

  const lockedIds = new Set(rules.locked ?? []);
  const excludedIds = new Set(rules.excluded ?? []);
  for (const id of [...lockedIds].sort()) {
    if (excludedIds.has(id)) return fail("lock-exclude-overlap", `Player ${id} is both locked and excluded.`);
    if (!known.has(id)) return fail("unknown-lock", `Locked player ${id} is not in the pool.`);
  }

  const eligible = players.filter((p) => !excludedIds.has(p.id)).sort(byId);
  const locked = eligible.filter((p) => lockedIds.has(p.id));

  const lc = countPositions(locked);
  const extra = Math.max(0, lc.RB - 2) + Math.max(0, lc.WR - 3) + Math.max(0, lc.TE - 1);
  if (lc.QB > 1 || lc.DST > 1 || lc.RB > 3 || lc.WR > 4 || lc.TE > 2 || extra > 1)
    return fail(
      "incompatible-locks",
      `Locks cannot share one roster (${lc.QB} QB, ${lc.RB} RB, ${lc.WR} WR, ${lc.TE} TE, ${lc.DST} DST; the roster holds 1 QB, 2 RB, 3 WR, 1 TE, 1 FLEX, 1 DST).`,
    );
  const lockedSalary = locked.reduce((s, p) => s + p.salary, 0);
  if (lockedSalary > cap) return fail("locks-over-cap", `Locked salary $${lockedSalary} exceeds the $${cap} cap.`);

  const ec = countPositions(eligible);
  if (ec.QB < 1 || ec.DST < 1 || ec.RB < 2 || ec.WR < 3 || ec.TE < 1 || ec.RB + ec.WR + ec.TE < 7)
    return fail(
      "insufficient-pool",
      `Eligible pool cannot fill a roster (${ec.QB} QB, ${ec.RB} RB, ${ec.WR} WR, ${ec.TE} TE, ${ec.DST} DST).`,
    );

  const salaryUnit = eligible.reduce((g, p) => gcd(g, p.salary), 0);
  const capUnits = Math.floor(cap / salaryUnit);
  if (capUnits > MAX_SALARY_UNITS)
    return fail(
      "salary-precision",
      `Salaries share a $${salaryUnit} unit, which splits the $${cap} cap into ${capUnits} steps (limit ${MAX_SALARY_UNITS}).`,
    );

  return {
    ok: true,
    input: { cap, eligible, locked, lockedIds, excludedIds, requireStack: rules.requireStack === true, salaryUnit, capUnits },
  };
}

/** Independent final check on a finished lineup; returns null when legal. */
export function validateRoster(entries: readonly RosterEntry[], rules: LineupRules): LineupIssue<RosterIssueCode> | null {
  if (entries.length !== ROSTER_SLOTS.length)
    return { code: "roster-size", message: `Lineup has ${entries.length} players; a roster needs ${ROSTER_SLOTS.length}.` };

  const ids = new Set<string>();
  let salary = 0;
  for (let i = 0; i < entries.length; i++) {
    const { slot, player } = entries[i]!;
    if (slot !== ROSTER_SLOTS[i]) return { code: "slot-order", message: `Slot ${i + 1} is ${slot}; expected ${ROSTER_SLOTS[i]}.` };
    const fits = slot === "FLEX" ? player.pos === "RB" || player.pos === "WR" || player.pos === "TE" : player.pos === slot;
    if (!fits) return { code: "slot-position", message: `${player.pos} ${player.id} cannot fill ${slot}.` };
    if (ids.has(player.id)) return { code: "duplicate-player", message: `Player ${player.id} appears twice.` };
    ids.add(player.id);
    salary += player.salary;
  }
  // Negated comparison so a NaN salary total is rejected too.
  if (!(salary <= rules.cap)) return { code: "over-cap", message: `Lineup salary $${salary} exceeds the $${rules.cap} cap.` };

  for (const id of rules.locked ?? []) {
    if (!ids.has(id)) return { code: "missing-lock", message: `Locked player ${id} is missing.` };
  }
  for (const id of rules.excluded ?? []) {
    if (ids.has(id)) return { code: "excluded-player", message: `Excluded player ${id} is in the lineup.` };
  }
  if (rules.requireStack) {
    const qb = entries.find((e) => e.slot === "QB")!.player;
    const stacked = entries.some((e) => (e.player.pos === "WR" || e.player.pos === "TE") && e.player.team === qb.team);
    if (!stacked) return { code: "missing-stack", message: `QB ${qb.id} has no WR/TE teammate from ${qb.team}.` };
  }
  return null;
}
