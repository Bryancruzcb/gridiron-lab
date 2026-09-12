// Legacy DST scoring, kept only to attribute changes in the regeneration report. It reproduces
// the dstPpr inputs of the study scripts at baseline ce5d6b1: the team's own def_* columns,
// points allowed estimated as the opponent's (passing + rushing TD) x 7 + FG x 3 + PAT (so each
// PAT counts twice), and 24 points allowed when the opponent's row is missing. Offense is not
// part of the variant: the current scorer equals nflverse fantasy_points_ppr on every 2025 row.
// Never the default and never a published result.

import { readCsv } from "../../../src/lib/football/csv.ts";
import type { DefenseRow } from "./prepare.ts";

export const LEGACY_SCORING_REF = "legacy-study-dst@ce5d6b1";

export const LEGACY_TEAM_COLUMNS = [
  "season",
  "week",
  "team",
  "season_type",
  "game_id",
  "opponent_team",
  "def_sacks",
  "def_interceptions",
  "fumble_recovery_opp",
  "def_tds",
  "passing_tds",
  "rushing_tds",
  "fg_made",
  "pat_made",
] as const;

/** The baseline scripts' dstPpr, unchanged. */
export function legacyDstPoints(opts: { pa: number; sacks: number; ints: number; turnovers: number; defTd: number }): number {
  const fum = Math.max(0, opts.turnovers - opts.ints);
  let pts = opts.sacks * 1 + opts.ints * 2 + fum * 2 + opts.defTd * 6;
  if (opts.pa <= 0) pts += 10;
  else if (opts.pa <= 6) pts += 7;
  else if (opts.pa <= 13) pts += 4;
  else if (opts.pa <= 20) pts += 1;
  else if (opts.pa <= 27) pts += 0;
  else if (opts.pa <= 34) pts -= 1;
  else pts -= 4;
  return Math.round(pts * 10) / 10;
}

/** Legacy team-defense rows for one season. Empty counts are zero, as in the baseline scripts. */
export function legacyDefenseRows(teamWeekText: string, season: number): DefenseRow[] {
  const table = readCsv(teamWeekText, LEGACY_TEAM_COLUMNS, "nflverse stats_team_week (legacy DST)");
  type LegacyTeam = {
    week: number;
    team: string;
    opp: string;
    gameId: string | null;
    sacks: number;
    ints: number;
    recov: number;
    defTd: number;
    passTd: number;
    rushTd: number;
    fg: number;
    pat: number;
  };
  const teams: LegacyTeam[] = [];
  const at = new Map<string, LegacyTeam>();
  for (const r of table.rows) {
    const seasonType = r.text("season_type");
    if (seasonType != null && seasonType !== "REG") continue;
    const week = r.num("week");
    const team = r.text("team");
    if (r.num("season") !== season || week == null || !team) continue;
    const t: LegacyTeam = {
      week,
      team,
      opp: r.text("opponent_team") ?? "",
      gameId: r.text("game_id"),
      sacks: r.num("def_sacks") ?? 0,
      ints: r.num("def_interceptions") ?? 0,
      recov: r.num("fumble_recovery_opp") ?? 0,
      defTd: r.num("def_tds") ?? 0,
      passTd: r.num("passing_tds") ?? 0,
      rushTd: r.num("rushing_tds") ?? 0,
      fg: r.num("fg_made") ?? 0,
      pat: r.num("pat_made") ?? 0,
    };
    teams.push(t);
    at.set(`${week}|${team}`, t);
  }
  return teams.map((t) => {
    const opp = at.get(`${t.week}|${t.opp}`);
    const pa = opp ? opp.passTd * 7 + opp.rushTd * 7 + opp.fg * 3 + opp.pat : 24;
    return {
      season,
      week: t.week,
      gameId: t.gameId,
      team: t.team,
      opponent: t.opp,
      status: "complete",
      points: legacyDstPoints({ pa, sacks: t.sacks, ints: t.ints, turnovers: t.ints + t.recov, defTd: t.defTd }),
      missing: [],
      pointsAllowed: pa,
      note: opp ? null : "legacy attribution: opponent row missing, 24 points allowed assumed",
    };
  });
}
