// Where study inputs come from and which columns each parser path needs.

import type { StudyInputRole } from "../../../src/data/types.ts";
import { PLAYER_WEEK_COLUMNS, SCHEDULE_COLUMNS, TEAM_WEEK_COLUMNS } from "../../../src/lib/football/nflverse.ts";

export const NFLVERSE_RELEASES = "https://github.com/nflverse/nflverse-data/releases/download";
/** One mutable file for every season; each run pins the bytes it read by hash. */
export const SCHEDULE_URL = "https://github.com/nflverse/nfldata/raw/master/data/games.csv";

/** Player-week columns the study reads beyond the scoring normalizer: usage and QB lag inputs. */
export const PLAYER_EXTRA_COLUMNS = ["targets", "passing_epa", "passing_cpoe"] as const;

export type InputSpec = {
  id: string;
  role: StudyInputRole;
  season: number | null;
  url: string;
  fileName: string;
  schemaId: string;
  /** Checked against the header when bytes enter the cache and every time they are read. */
  requiredColumns: readonly string[];
};

export function playerWeekSpec(season: number): InputSpec {
  const fileName = `stats_player_week_${season}.csv`;
  return {
    id: `stats_player_week_${season}`,
    role: "player-week",
    season,
    url: `${NFLVERSE_RELEASES}/stats_player/${fileName}`,
    fileName,
    schemaId: "nflverse-stats-player-week/study-columns@1",
    requiredColumns: [...PLAYER_WEEK_COLUMNS, ...PLAYER_EXTRA_COLUMNS],
  };
}

export function teamWeekSpec(season: number): InputSpec {
  const fileName = `stats_team_week_${season}.csv`;
  return {
    id: `stats_team_week_${season}`,
    role: "team-week",
    season,
    url: `${NFLVERSE_RELEASES}/stats_team/${fileName}`,
    fileName,
    schemaId: "nflverse-stats-team-week/study-columns@1",
    requiredColumns: [...TEAM_WEEK_COLUMNS],
  };
}

export const SCHEDULE_SPEC: InputSpec = {
  id: "nfldata_games",
  role: "schedule",
  season: null,
  url: SCHEDULE_URL,
  fileName: "games.csv",
  schemaId: "nfldata-games/study-columns@1",
  requiredColumns: [...SCHEDULE_COLUMNS],
};

/** A local JSON universe file (the shipped fantasy slate or a frozen universe); hashed like any input. */
export function universeFileSpec(id: string, url: string, fileName: string): InputSpec {
  return { id, role: "universe-file", season: null, url, fileName, schemaId: "gridiron-lab-universe-file@1", requiredColumns: [] };
}

/** The three files one season's evaluation reads. */
export function seasonSpecs(season: number): InputSpec[] {
  return [playerWeekSpec(season), teamWeekSpec(season), SCHEDULE_SPEC];
}
