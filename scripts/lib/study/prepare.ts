// Joins one season's sources into the rows the study reads: the schedule (pregame opponents and
// final scores), scored player weeks with usage columns, and scored team defenses. Built on the
// shared nflverse normalizers and scoring rules; missing values stay missing.

import { readCsv } from "../../../src/lib/football/csv.ts";
import {
  defenseWeeks,
  nflverseSeasonType,
  parsePlayerWeeks,
  parseSchedule,
  parseTeamWeeks,
} from "../../../src/lib/football/nflverse.ts";
import { indexPlayerWeeks, playerWeekId } from "../../../src/lib/football/player-weeks.ts";
import { RULESET_REF, type ScoreResult } from "../../../src/lib/football/scoring.ts";
import { StudyConfigError } from "./errors.ts";
import { LEGACY_SCORING_REF, legacyDefenseRows } from "./legacy-scoring.ts";
import { PLAYER_EXTRA_COLUMNS } from "./sources.ts";

export const SCORING_REFS: readonly string[] = [RULESET_REF, LEGACY_SCORING_REF];

export function checkScoringRef(ref: string): string {
  if (!SCORING_REFS.includes(ref)) {
    throw new StudyConfigError(`unknown scoring ${JSON.stringify(ref)}; expected ${SCORING_REFS.join(" or ")}`);
  }
  return ref;
}

export type ScoreStatus = ScoreResult["status"];

export type ScheduledGame = {
  gameId: string;
  season: number;
  week: number;
  away: string;
  home: string;
  awayScore: number | null;
  homeScore: number | null;
  final: boolean;
};

export type PlayerRow = {
  season: number;
  week: number;
  gameId: string | null;
  playerId: string;
  name: string;
  team: string;
  position: string | null;
  status: ScoreStatus;
  /** null when the score is missing. */
  points: number | null;
  /** Missing (status missing) or unavailable (status partial) scoring inputs. */
  missing: string[];
  attempts: number | null;
  carries: number | null;
  targets: number | null;
  passingEpa: number | null;
  passingCpoe: number | null;
};

export type DefenseRow = {
  season: number;
  week: number;
  gameId: string | null;
  team: string;
  opponent: string;
  status: ScoreStatus;
  points: number | null;
  missing: string[];
  pointsAllowed: number | null;
  note: string | null;
};

export type PreparedSeason = {
  season: number;
  scoring: string;
  /** Regular-season games sorted by week then game id. */
  games: ScheduledGame[];
  /** Sorted by week, game id, player id. */
  players: PlayerRow[];
  /** Sorted by week, game id, team. */
  defenses: DefenseRow[];
  /** Weeks with at least one player row. */
  statWeeks: number[];
  skipped: { source: string; line: number; reason: string }[];
};

export type SeasonTexts = { playerWeek: string; teamWeek: string; schedule: string };

function cmp(a: string | null, b: string | null): number {
  const x = a ?? "";
  const y = b ?? "";
  return x < y ? -1 : x > y ? 1 : 0;
}

function scoreFields(score: ScoreResult): Pick<PlayerRow, "status" | "points" | "missing"> {
  switch (score.status) {
    case "complete":
      return { status: "complete", points: score.points, missing: [] };
    case "partial":
      return { status: "partial", points: score.points, missing: [...score.unavailable] };
    case "missing":
      return { status: "missing", points: null, missing: [...score.missing] };
  }
}

/**
 * Prepares one regular season. Throws on a missing or non-numeric required column, a repeated
 * game, a team scheduled twice in a week, or a repeated player-week or team-week key.
 */
export function prepareSeason(season: number, texts: SeasonTexts, opts: { scoring: string }): PreparedSeason {
  const scoring = checkScoringRef(opts.scoring);
  const skipped: PreparedSeason["skipped"] = [];

  const schedule = parseSchedule(texts.schedule, "nfldata games.csv");
  skipped.push(...schedule.skipped.map((s) => ({ source: "schedule", ...s })));
  const seasonGames = schedule.rows.filter((g) => g.season === season && g.seasonType === "REG");
  const gameIds = new Set<string>();
  const teamWeeks = new Set<string>();
  for (const g of seasonGames) {
    if (gameIds.has(g.gameId)) throw new Error(`schedule: game ${g.gameId} appears twice`);
    gameIds.add(g.gameId);
    for (const team of [g.away, g.home]) {
      const key = `${g.week}|${team}`;
      if (teamWeeks.has(key)) throw new Error(`schedule: ${team} has two games in ${season} week ${g.week}`);
      teamWeeks.add(key);
    }
  }
  const games: ScheduledGame[] = seasonGames
    .map((g) => ({
      gameId: g.gameId,
      season,
      week: g.week,
      away: g.away,
      home: g.home,
      awayScore: g.awayScore,
      homeScore: g.homeScore,
      final: g.awayScore != null && g.homeScore != null,
    }))
    .sort((a, b) => a.week - b.week || cmp(a.gameId, b.gameId));

  const playerSource = "nflverse stats_player_week";
  const parsedPlayers = parsePlayerWeeks(texts.playerWeek, playerSource);
  skipped.push(...parsedPlayers.skipped.map((s) => ({ source: "player-week", ...s })));
  const seasonRows = parsedPlayers.rows.filter((r) => r.season === season && r.seasonType === "REG");
  indexPlayerWeeks(seasonRows);

  const extras = new Map<string, { targets: number | null; passingEpa: number | null; passingCpoe: number | null }>();
  const extraTable = readCsv(
    texts.playerWeek,
    ["player_id", "season", "week", "season_type", ...PLAYER_EXTRA_COLUMNS] as const,
    playerSource,
  );
  for (const r of extraTable.rows) {
    const playerId = r.text("player_id");
    const rowSeason = r.num("season");
    const week = r.num("week");
    if (!playerId || rowSeason !== season || week == null) continue;
    if (nflverseSeasonType(r.text("season_type"), playerSource) !== "REG") continue;
    extras.set(playerWeekId({ season, seasonType: "REG", week, playerId }), {
      targets: r.num("targets"),
      passingEpa: r.num("passing_epa"),
      passingCpoe: r.num("passing_cpoe"),
    });
  }

  const players: PlayerRow[] = seasonRows
    .map((r) => {
      const x = extras.get(playerWeekId(r));
      return {
        season,
        week: r.week,
        gameId: r.gameId,
        playerId: r.playerId,
        name: r.name,
        team: r.team,
        position: r.position,
        ...scoreFields(r.score),
        attempts: r.box.attempts,
        carries: r.box.carries,
        targets: x?.targets ?? null,
        passingEpa: x?.passingEpa ?? null,
        passingCpoe: x?.passingCpoe ?? null,
      };
    })
    .sort((a, b) => a.week - b.week || cmp(a.gameId, b.gameId) || cmp(a.playerId, b.playerId));

  let defenses: DefenseRow[];
  if (scoring === LEGACY_SCORING_REF) {
    defenses = legacyDefenseRows(texts.teamWeek, season);
  } else {
    const parsedTeams = parseTeamWeeks(texts.teamWeek, "nflverse stats_team_week");
    skipped.push(...parsedTeams.skipped.map((s) => ({ source: "team-week", ...s })));
    const teams = parsedTeams.rows.filter((t) => t.season === season && t.seasonType === "REG");
    const seen = new Set<string>();
    for (const t of teams) {
      const key = `${t.week}|${t.team}`;
      if (seen.has(key)) throw new Error(`team week: ${t.team} has two rows in ${season} week ${t.week}`);
      seen.add(key);
    }
    defenses = defenseWeeks(teams, seasonGames).map((d) => ({
      season,
      week: d.week,
      gameId: d.gameId,
      team: d.team,
      opponent: d.opponent,
      ...scoreFields(d.score),
      pointsAllowed: d.stats.pointsAllowed,
      note: gameIds.has(d.gameId) ? null : "game not in schedule",
    }));
  }
  defenses.sort((a, b) => a.week - b.week || cmp(a.gameId, b.gameId) || cmp(a.team, b.team));

  const statWeeks = [...new Set(players.map((r) => r.week))].sort((a, b) => a - b);
  return { season, scoring, games, players, defenses, statWeeks, skipped };
}
