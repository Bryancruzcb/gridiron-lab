import type { FantasyPlayer, FantasyPos } from "../../../src/data/types.ts";
import { player } from "./players.ts";
import type { Rng } from "./prng.ts";

export type GeneratedCase = {
  label: string;
  players: FantasyPlayer[];
  cap: number;
  locked: string[];
  excluded: string[];
  requireStack: boolean;
};

const BASE: FantasyPos[] = ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "DST"];
const EXTRA: FantasyPos[] = ["QB", "RB", "RB", "WR", "WR", "TE", "DST"];
const TEAM_CODES = ["ARI", "BUF", "CHI", "DAL", "DEN", "DET", "GB", "HOU", "KC", "LV", "MIA", "NE"];

/** Random pool with every base position present; ties are common when tieMode is on. */
export function randomPool(
  rng: Rng,
  size: number,
  opts: { unit?: number; teams?: number; maxSalary?: number } = {},
): FantasyPlayer[] {
  const positions = [...BASE];
  while (positions.length < size) positions.push(rng.pick(EXTRA));
  const unit = opts.unit ?? rng.pick([100, 100, 100, 50, 25]);
  const teams = TEAM_CODES.slice(0, opts.teams ?? 3);
  const tieMode = rng.chance(0.25);
  return rng.shuffle(positions).map((pos, i) => {
    const salary = unit * rng.int(Math.ceil(2000 / unit), Math.floor((opts.maxSalary ?? 9000) / unit));
    const proj = tieMode ? rng.pick([0, 4.5, 9, 9, 12.25, -1.5]) : Math.round((rng.next() * 33 - 3) * 100) / 100;
    return player(`p${String(i).padStart(3, "0")}`, pos, salary, proj, rng.pick(teams));
  });
}

/** Small slate with random locks, exclusions, stacks, thin pools and occasional malformed input. */
export function randomCase(rng: Rng, index: number): GeneratedCase {
  // Up to 8 teams so an unconstrained optimum is often unstacked; $7,000 max keeps many slates feasible.
  let players = randomPool(rng, rng.int(12, 16), { teams: rng.pick([3, 6, 8]), maxSalary: 7000 });
  let label = `case ${index}`;
  if (rng.chance(0.12)) {
    const pos = rng.pick<FantasyPos>(["QB", "RB", "WR", "TE", "DST"]);
    const same = players.filter((p) => p.pos === pos);
    const drop = new Set(same.slice(0, rng.int(1, same.length)).map((p) => p.id));
    players = players.filter((p) => !drop.has(p.id));
    label += ` thin-${pos}`;
  }
  const cap = rng.pick([26000, 34000, 40000, 45000, 50000]);
  const locked = rng
    .shuffle(players)
    .slice(0, rng.int(0, 3))
    .map((p) => p.id);
  const excluded = rng
    .shuffle(players.filter((p) => !locked.includes(p.id)))
    .slice(0, rng.int(0, 2))
    .map((p) => p.id);
  const c: GeneratedCase = { label, players, cap, locked, excluded, requireStack: rng.chance(0.3) };
  if (rng.chance(0.15)) injectMalformed(rng, c);
  return c;
}

function injectMalformed(rng: Rng, c: GeneratedCase) {
  const at = rng.int(0, c.players.length - 1);
  const victim = c.players[at]!;
  switch (rng.int(0, 5)) {
    case 0:
      c.players = [...c.players, { ...victim }];
      c.label += " duplicate-id";
      break;
    case 1:
      c.locked = [...c.locked, victim.id];
      c.excluded = [...c.excluded, victim.id];
      c.label += " lock-exclude-overlap";
      break;
    case 2:
      c.locked = [...c.locked, "ghost"];
      c.label += " unknown-lock";
      break;
    case 3:
      c.players = c.players.map((p, i) => (i === at ? { ...p, proj: rng.pick([Number.NaN, Infinity, -Infinity]) } : p));
      c.label += " non-finite-projection";
      break;
    case 4:
      c.players = c.players.map((p, i) => (i === at ? { ...p, salary: rng.pick([0, -100, 2050.5]) } : p));
      c.label += " invalid-salary";
      break;
    default:
      c.cap = rng.pick([0, -50000, Number.NaN, Infinity]);
      c.label += " invalid-cap";
  }
}
