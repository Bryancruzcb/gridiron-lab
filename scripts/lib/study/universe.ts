// Player/salary universes. A universe is frozen before evaluation and identified by the sha256 of
// its canonical JSON. The shipped src/data/fantasy.json stays available as the named legacy universe.

import type {
  FantasyPos,
  StudyUniverse,
  StudyUniversePlayer,
  StudyUniverseRef,
  SyntheticUniverseParams,
} from "../../../src/data/types.ts";
import { RULESET_REF } from "../../../src/lib/football/scoring.ts";
import { isRecord, StudyConfigError } from "./errors.ts";
import { hashJson, sha256Hex } from "./hash.ts";
import type { PreparedSeason } from "./prepare.ts";

export const LEGACY_UNIVERSE_ID = "legacy-fantasy-json";
/** Prior-season PPG pool selection; salaries are unit placeholders, not market prices. */
export const SYNTHETIC_RULE = "synthetic-prior-season@2";
/**
 * Placeholder salary on every synthetic-pool player. Types/solver still require positive salary;
 * these are not DraftKings (or any market) prices. Roster construction may still run but is not
 * the scientific Result — player MAE is.
 */
export const SYNTHETIC_PLACEHOLDER_SALARY = 1;
/**
 * Non-market cap for synthetic pools: roster has 9 slots at unit salary 1, so 9 is the minimum
 * feasible budget. Deliberately not $50k / DK-shaped.
 */
export const SYNTHETIC_PLACEHOLDER_CAP = 9;
const SCHEMA = "gridiron-lab-study-universe@1";
const POSITIONS: readonly FantasyPos[] = ["QB", "RB", "WR", "TE", "DST"];

function byId(a: { id: string }, b: { id: string }) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function checkUniverse(players: readonly StudyUniversePlayer[], cap: number, where: string) {
  if (!Number.isSafeInteger(cap) || cap <= 0) throw new StudyConfigError(`${where}: cap must be a positive whole number, got ${cap}`);
  const ids = new Set<string>();
  for (const p of players) {
    if (ids.has(p.id)) throw new StudyConfigError(`${where}: player id ${p.id} appears twice`);
    ids.add(p.id);
    if (!POSITIONS.includes(p.pos)) throw new StudyConfigError(`${where}: ${p.id} has unsupported position ${p.pos}`);
    if (!Number.isSafeInteger(p.salary) || p.salary <= 0) {
      throw new StudyConfigError(`${where}: ${p.id} salary must be a positive whole number, got ${p.salary}`);
    }
    if (!p.team) throw new StudyConfigError(`${where}: ${p.id} has no team`);
  }
  for (const pos of POSITIONS) {
    if (!players.some((p) => p.pos === pos)) throw new StudyConfigError(`${where}: universe has no ${pos}`);
  }
}

function field<T extends "string" | "number">(
  obj: Record<string, unknown>,
  name: string,
  type: T,
  where: string,
): T extends "string" ? string : number {
  const v = obj[name];
  if (typeof v !== type || (type === "number" && !Number.isFinite(v))) {
    throw new StudyConfigError(`${where}: ${name} must be a ${type}, got ${JSON.stringify(v)}`);
  }
  return v as T extends "string" ? string : number;
}

function readPlayers(list: unknown, where: string): StudyUniversePlayer[] {
  if (!Array.isArray(list)) throw new StudyConfigError(`${where}: players must be an array`);
  return list
    .map((raw, i) => {
      const at = `${where} players[${i}]`;
      if (!isRecord(raw)) throw new StudyConfigError(`${at}: expected an object`);
      return {
        id: field(raw, "id", "string", at),
        name: field(raw, "name", "string", at),
        pos: field(raw, "pos", "string", at) as FantasyPos,
        team: field(raw, "team", "string", at),
        salary: field(raw, "salary", "number", at),
      };
    })
    .sort(byId);
}

/** The shipped slate as a universe. Its selection and salaries used the full season it describes. */
export function legacyUniverse(bytes: Uint8Array, sourceId = "fantasy.json"): StudyUniverse {
  let file: unknown;
  try {
    file = JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    throw new StudyConfigError(`${sourceId}: not valid JSON (${(e as Error).message})`);
  }
  if (!isRecord(file)) throw new StudyConfigError(`${sourceId}: expected a fantasy file object`);
  const season = field(file, "season", "number", sourceId);
  const cap = field(file, "cap", "number", sourceId);
  const players = readPlayers(file.players, sourceId);
  checkUniverse(players, cap, sourceId);
  const note = typeof file.source === "string" ? file.source : "no source note";
  return {
    schemaVersion: SCHEMA,
    id: LEGACY_UNIVERSE_ID,
    rule: "legacy-fantasy-json",
    season,
    cap,
    description: `The shipped synthetic slate of ${players.length} players (${note}).`,
    informationCutoff:
      `Selected and priced outside this pipeline from full ${season} regular-season data, so the pool and ` +
      `salaries use information from after every ${season} prediction cutoff (look-ahead).`,
    lookAhead: true,
    params: null,
    sourceInputs: [{ id: sourceId, sha256: sha256Hex(bytes) }],
    players,
  };
}

export function defaultSyntheticParams(fromSeason: number): SyntheticUniverseParams {
  return {
    fromSeason,
    minGames: 4,
    counts: { QB: 18, RB: 28, WR: 36, TE: 16, DST: 16 },
    scoring: RULESET_REF,
  };
}

type Candidate = { id: string; name: string; team: string; pos: FantasyPos; games: number; points: number; ppg: number };

function checkParams(params: SyntheticUniverseParams) {
  const where = SYNTHETIC_RULE;
  if (!Number.isInteger(params.minGames) || params.minGames < 1) throw new StudyConfigError(`${where}: minGames must be >= 1`);
  for (const pos of POSITIONS) {
    const n = params.counts[pos];
    if (!Number.isInteger(n) || n < 1) throw new StudyConfigError(`${where}: counts.${pos} must be a whole number >= 1`);
  }
}

function modalPosition(rows: readonly { position: string | null }[]): string | null {
  const counts = new Map<string, { n: number; last: number }>();
  rows.forEach((r, i) => {
    if (!r.position) return;
    const c = counts.get(r.position) ?? { n: 0, last: -1 };
    counts.set(r.position, { n: c.n + 1, last: i });
  });
  let best: string | null = null;
  let bestCell = { n: 0, last: -1 };
  for (const [pos, cell] of counts) {
    if (cell.n > bestCell.n || (cell.n === bestCell.n && cell.last > bestCell.last)) {
      best = pos;
      bestCell = cell;
    }
  }
  return best;
}

/**
 * synthetic-prior-season@2: from season S-1 regular-season rows only, take the top counts[pos]
 * players (and team defenses) by points per game with at least minGames scored games (ties: more
 * points, then id). Every player gets unit placeholder salary SYNTHETIC_PLACEHOLDER_SALARY; the
 * universe cap is SYNTHETIC_PLACEHOLDER_CAP (roster-slot scale, not a market budget). Team and name
 * come from the latest S-1 row. Rookies and offseason moves are absent.
 */
export function syntheticUniverse(
  prior: PreparedSeason,
  params: SyntheticUniverseParams,
  opts: { sourceInputs: { id: string; sha256: string }[] },
): StudyUniverse {
  checkParams(params);
  if (prior.season !== params.fromSeason) {
    throw new StudyConfigError(`${SYNTHETIC_RULE}: prepared season ${prior.season} is not fromSeason ${params.fromSeason}`);
  }
  if (prior.scoring !== params.scoring) {
    throw new StudyConfigError(`${SYNTHETIC_RULE}: prior season was scored with ${prior.scoring}, the rule needs ${params.scoring}`);
  }
  const candidates: Record<FantasyPos, Candidate[]> = { QB: [], RB: [], WR: [], TE: [], DST: [] };

  const byPlayer = new Map<string, PreparedSeason["players"]>();
  for (const r of prior.players) {
    if (r.points == null) continue;
    const list = byPlayer.get(r.playerId) ?? [];
    list.push(r);
    byPlayer.set(r.playerId, list);
  }
  for (const [id, rows] of byPlayer) {
    const pos = modalPosition(rows);
    if (pos !== "QB" && pos !== "RB" && pos !== "WR" && pos !== "TE") continue;
    if (rows.length < params.minGames) continue;
    const last = rows[rows.length - 1]!;
    const points = rows.reduce((s, r) => s + r.points!, 0);
    candidates[pos].push({ id, name: last.name, team: last.team, pos, games: rows.length, points, ppg: points / rows.length });
  }

  const byTeam = new Map<string, number[]>();
  for (const r of prior.defenses) {
    if (r.points == null) continue;
    const list = byTeam.get(r.team) ?? [];
    list.push(r.points);
    byTeam.set(r.team, list);
  }
  for (const [team, pts] of byTeam) {
    if (pts.length < params.minGames) continue;
    const points = pts.reduce((s, x) => s + x, 0);
    candidates.DST.push({ id: `DST-${team}`, name: `${team} D/ST`, team, pos: "DST", games: pts.length, points, ppg: points / pts.length });
  }

  const players: StudyUniversePlayer[] = [];
  for (const pos of POSITIONS) {
    const picked = candidates[pos]
      .sort((a, b) => b.ppg - a.ppg || b.points - a.points || byId(a, b))
      .slice(0, params.counts[pos]);
    for (const c of picked) {
      players.push({ id: c.id, name: c.name, pos, team: c.team, salary: SYNTHETIC_PLACEHOLDER_SALARY });
    }
  }
  players.sort(byId);
  const season = params.fromSeason + 1;
  const cap = SYNTHETIC_PLACEHOLDER_CAP;
  checkUniverse(players, cap, `${SYNTHETIC_RULE} for ${season}`);
  return {
    schemaVersion: SCHEMA,
    id: `${SYNTHETIC_RULE}:${season}`,
    rule: SYNTHETIC_RULE,
    season,
    cap,
    description:
      `Top players by ${params.fromSeason} regular-season points per game (at least ${params.minGames} games). ` +
      `Salaries are unit placeholders (${SYNTHETIC_PLACEHOLDER_SALARY} each), not market or DraftKings prices; ` +
      `cap ${cap} is roster-slot scale so the solver can still build a lineup. Player MAE is the Result, not DFS edge.`,
    informationCutoff:
      `Only ${params.fromSeason} regular-season rows scored with ${params.scoring}; frozen before ${season} week 1. ` +
      `Rookies and offseason team changes are not reflected. Salaries are placeholders, not priced from any market.`,
    lookAhead: false,
    params,
    sourceInputs: [...opts.sourceInputs].sort(byId),
    players,
  };
}

export function universeRef(universe: StudyUniverse): StudyUniverseRef {
  return {
    id: universe.id,
    rule: universe.rule,
    season: universe.season,
    sha256: hashJson(universe),
    players: universe.players.length,
    lookAhead: universe.lookAhead,
  };
}

/** Reads a universe written by the study CLI and re-validates it. */
export function parseFrozenUniverse(text: string, source: string): StudyUniverse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new StudyConfigError(`${source}: not valid JSON (${(e as Error).message})`);
  }
  if (!isRecord(value) || value.schemaVersion !== SCHEMA) {
    throw new StudyConfigError(`${source}: expected schemaVersion ${SCHEMA}`);
  }
  if (value.rule !== "legacy-fantasy-json" && value.rule !== SYNTHETIC_RULE) {
    throw new StudyConfigError(`${source}: unknown universe rule ${JSON.stringify(value.rule)}`);
  }
  const players = readPlayers(value.players, source);
  const cap = field(value, "cap", "number", source);
  checkUniverse(players, cap, source);
  return { ...(value as StudyUniverse), players };
}
