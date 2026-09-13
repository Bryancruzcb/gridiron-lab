// Per-week player rows keyed by season + season type + week + player, and the season
// aggregate derived from them. Weekly rows are never mutated into season totals.

import { isScored, roundPoints, type OffenseStats, type ScoreResult } from "./scoring.ts";

export type SeasonType = "PRE" | "REG" | "POST";

export type WeekKey = { season: number; seasonType: SeasonType; week: number };

export function weekKeyId(k: WeekKey): string {
  return `${k.season}-${k.seasonType}-${String(k.week).padStart(2, "0")}`;
}

export function sameWeek(a: WeekKey, b: WeekKey): boolean {
  return a.season === b.season && a.seasonType === b.seasonType && a.week === b.week;
}

/** Counting stats as the source reported them; null when the source left the cell empty. */
export type PlayerBox = {
  completions: number | null;
  attempts: number | null;
  passingYards: number | null;
  passingTds: number | null;
  interceptions: number | null;
  sacksSuffered: number | null;
  carries: number | null;
  rushingYards: number | null;
  rushingTds: number | null;
  receptions: number | null;
  receivingYards: number | null;
  receivingTds: number | null;
};

export type PlayerWeek = WeekKey & {
  playerId: string;
  name: string;
  team: string;
  opponent: string | null;
  position: string | null;
  headshot: string | null;
  gameId: string | null;
  box: PlayerBox;
  offense: OffenseStats;
  score: ScoreResult;
};

export function playerWeekId(row: WeekKey & { playerId: string }): string {
  return `${weekKeyId(row)}|${row.playerId}`;
}

/** A repeated season/type/week/player key is a data error, not something to sum. */
export function indexPlayerWeeks(rows: readonly PlayerWeek[]): Map<string, PlayerWeek> {
  const out = new Map<string, PlayerWeek>();
  for (const row of rows) {
    const id = playerWeekId(row);
    if (out.has(id)) throw new Error(`duplicate player week ${id}`);
    out.set(id, row);
  }
  return out;
}

export type SeasonBox = {
  completions: number;
  attempts: number;
  passingYards: number;
  passingTds: number;
  interceptions: number;
  sacksSuffered: number;
  carries: number;
  rushingYards: number;
  rushingTds: number;
  receptions: number;
  receivingYards: number;
  receivingTds: number;
};

export type PlayerSeason = {
  season: number;
  seasonType: SeasonType;
  playerId: string;
  name: string;
  /** Team, position and headshot from the latest week. */
  team: string;
  position: string | null;
  headshot: string | null;
  games: number;
  throughWeek: number;
  /** Sums of reported counts; empty cells add nothing. */
  box: SeasonBox;
  /** Sum of weekly points, or null when any week could not be scored. */
  ppr: number | null;
};

const BOX_KEYS = [
  "completions",
  "attempts",
  "passingYards",
  "passingTds",
  "interceptions",
  "sacksSuffered",
  "carries",
  "rushingYards",
  "rushingTds",
  "receptions",
  "receivingYards",
  "receivingTds",
] as const satisfies readonly (keyof PlayerBox)[];

export function aggregateSeason(
  rows: readonly PlayerWeek[],
  season: number,
  seasonType: SeasonType,
): PlayerSeason[] {
  const weeks = new Map<string, PlayerWeek[]>();
  for (const row of rows) {
    if (row.season !== season || row.seasonType !== seasonType) continue;
    const list = weeks.get(row.playerId) ?? [];
    list.push(row);
    weeks.set(row.playerId, list);
  }
  const out: PlayerSeason[] = [];
  for (const [playerId, list] of weeks) {
    list.sort((a, b) => a.week - b.week);
    const last = list[list.length - 1]!;
    const box = Object.fromEntries(BOX_KEYS.map((k) => [k, 0])) as SeasonBox;
    let ppr: number | null = 0;
    for (const w of list) {
      for (const k of BOX_KEYS) box[k] += w.box[k] ?? 0;
      ppr = ppr != null && isScored(w.score) ? ppr + w.score.points : null;
    }
    out.push({
      season,
      seasonType,
      playerId,
      name: last.name,
      team: last.team,
      position: last.position,
      headshot: last.headshot,
      games: list.length,
      throughWeek: last.week,
      box,
      ppr: ppr == null ? null : roundPoints(ppr),
    });
  }
  return out;
}

/** Latest week present for a season and type, or null when the source has none yet. */
export function throughWeek(rows: readonly WeekKey[], season: number, seasonType: SeasonType): number | null {
  let max: number | null = null;
  for (const r of rows) {
    if (r.season === season && r.seasonType === seasonType && (max == null || r.week > max)) max = r.week;
  }
  return max;
}
