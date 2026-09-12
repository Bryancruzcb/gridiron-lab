import type { FantasyPlayer } from "../../../src/data/types.ts";

// Brute-force reference for the lineup solver. It enumerates every 9-player subset
// and applies its own legality rule, sharing no code with src/lib/optimizer.ts or
// src/lib/football/lineup-validation.ts.

export type OracleRules = {
  cap: number;
  locked: readonly string[];
  excluded: readonly string[];
  requireStack: boolean;
};

export type OracleAnswer =
  | { kind: "malformed"; reason: string }
  | { kind: "no-lineup" }
  | { kind: "best"; score: number; optimal: Set<string>; legalCount: number };

export function lineupKey(players: readonly { id: string }[]) {
  return players
    .map((p) => p.id)
    .sort()
    .join(",");
}

/** Input problems that make the question itself ill-posed, independent of roster feasibility. */
export function malformedReason(players: readonly FantasyPlayer[], rules: OracleRules): string | null {
  if (!(Number.isFinite(rules.cap) && rules.cap > 0)) return "cap";
  const seen = new Set<string>();
  for (const p of players) {
    if (seen.has(p.id)) return "duplicate id";
    seen.add(p.id);
    if (!Number.isInteger(p.salary) || p.salary <= 0) return "salary";
    if (!Number.isFinite(p.proj)) return "projection";
  }
  for (const id of rules.locked) {
    if (rules.excluded.includes(id)) return "locked and excluded";
    if (!seen.has(id)) return "unknown lock";
  }
  return null;
}

/** 9 unique players: 1 QB, 1 DST, RB >= 2, WR >= 3, TE >= 1, RB + WR + TE = 7, under the cap. */
export function isLegalLineup(players: readonly FantasyPlayer[], rules: OracleRules): boolean {
  if (players.length !== 9) return false;
  const ids = new Set<string>();
  let qb = 0;
  let rb = 0;
  let wr = 0;
  let te = 0;
  let dst = 0;
  let salary = 0;
  for (const p of players) {
    ids.add(p.id);
    salary += p.salary;
    if (p.pos === "QB") qb++;
    else if (p.pos === "RB") rb++;
    else if (p.pos === "WR") wr++;
    else if (p.pos === "TE") te++;
    else if (p.pos === "DST") dst++;
  }
  if (ids.size !== 9) return false;
  if (qb !== 1 || dst !== 1 || rb < 2 || wr < 3 || te < 1 || rb + wr + te !== 7) return false;
  if (!(salary <= rules.cap)) return false;
  if (rules.locked.some((id) => !ids.has(id))) return false;
  if (rules.excluded.some((id) => ids.has(id))) return false;
  if (rules.requireStack) {
    const q = players.find((p) => p.pos === "QB")!;
    if (!players.some((p) => (p.pos === "WR" || p.pos === "TE") && p.team === q.team)) return false;
  }
  return true;
}

export function exhaustiveBest(players: readonly FantasyPlayer[], rules: OracleRules, tolerance = 1e-6): OracleAnswer {
  const reason = malformedReason(players, rules);
  if (reason) return { kind: "malformed", reason };

  const legal: { score: number; key: string }[] = [];
  const chosen: FantasyPlayer[] = [];
  const visit = (start: number) => {
    if (chosen.length === 9) {
      if (isLegalLineup(chosen, rules)) {
        legal.push({ score: chosen.reduce((s, p) => s + p.proj, 0), key: lineupKey(chosen) });
      }
      return;
    }
    for (let i = start; i <= players.length - (9 - chosen.length); i++) {
      chosen.push(players[i]!);
      visit(i + 1);
      chosen.pop();
    }
  };
  visit(0);

  if (legal.length === 0) return { kind: "no-lineup" };
  const score = Math.max(...legal.map((l) => l.score));
  const optimal = new Set(legal.filter((l) => l.score >= score - tolerance).map((l) => l.key));
  return { kind: "best", score, optimal, legalCount: legal.length };
}
