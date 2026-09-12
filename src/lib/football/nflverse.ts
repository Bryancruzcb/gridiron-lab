// Normalizers for nflverse CSV releases. Each maps named source columns onto the project's
// normalized shapes; scoring.ts applies the rules. Column semantics below were checked against
// the 2025 stats_player_week, stats_team_week and nfldata games.csv files.

import { readCsv, type CsvRow } from "./csv.ts";
import { GAME_EVENT_POINTS, scoreDefense, scoreOffense, type DefenseStats, type ScoreResult } from "./scoring.ts";
import type { PlayerWeek, SeasonType, WeekKey } from "./player-weeks.ts";

export type Skipped = { line: number; reason: string };

/** Stats files use REG/POST; the schedule's game_type splits the postseason into WC/DIV/CON/SB. */
export function nflverseSeasonType(raw: string | null, source: string): SeasonType {
  switch (raw) {
    case "PRE":
      return "PRE";
    case "REG":
      return "REG";
    case "POST":
    case "WC":
    case "DIV":
    case "CON":
    case "SB":
      return "POST";
    default:
      throw new Error(`${source}: unknown season type ${JSON.stringify(raw)}`);
  }
}

function sumOrNull(...values: (number | null)[]): number | null {
  let total = 0;
  for (const v of values) {
    if (v == null) return null;
    total += v;
  }
  return total;
}

function weekKeyOf<C extends string>(
  row: CsvRow<C | "season" | "week">,
  seasonType: string | null,
  source: string,
): WeekKey | null {
  const season = row.num("season");
  const week = row.num("week");
  if (season == null || week == null) return null;
  return { season, seasonType: nflverseSeasonType(seasonType, source), week };
}

// stats_player_week_<season>.csv: one row per player per game.
export const PLAYER_WEEK_COLUMNS = [
  "player_id",
  "player_name",
  "player_display_name",
  "position",
  "headshot_url",
  "season",
  "week",
  "season_type",
  "game_id",
  "team",
  "opponent_team",
  "completions",
  "attempts",
  "passing_yards",
  "passing_tds",
  "passing_interceptions",
  "sacks_suffered",
  "sack_fumbles_lost",
  "passing_2pt_conversions",
  "carries",
  "rushing_yards",
  "rushing_tds",
  "rushing_fumbles_lost",
  "rushing_2pt_conversions",
  "receptions",
  "receiving_yards",
  "receiving_tds",
  "receiving_fumbles_lost",
  "receiving_2pt_conversions",
  "special_teams_tds",
] as const;

type PlayerCol = (typeof PLAYER_WEEK_COLUMNS)[number];

export function parsePlayerWeeks(
  text: string,
  source = "nflverse stats_player_week",
): { rows: PlayerWeek[]; skipped: Skipped[] } {
  const table = readCsv(text, PLAYER_WEEK_COLUMNS, source);
  const rows: PlayerWeek[] = [];
  const skipped: Skipped[] = [];
  for (const r of table.rows) {
    const playerId = r.text("player_id");
    const team = r.text("team");
    const key = weekKeyOf<PlayerCol>(r, r.text("season_type"), source);
    if (!playerId || !team || !key) {
      skipped.push({ line: r.line, reason: "missing player_id, team, season or week" });
      continue;
    }
    const offense = {
      passingYards: r.num("passing_yards"),
      passingTds: r.num("passing_tds"),
      interceptions: r.num("passing_interceptions"),
      rushingYards: r.num("rushing_yards"),
      rushingTds: r.num("rushing_tds"),
      receptions: r.num("receptions"),
      receivingYards: r.num("receiving_yards"),
      receivingTds: r.num("receiving_tds"),
      // Scrimmage fumbles lost only. fumbles_lost_total also counts return fumbles; nflverse's
      // own fantasy_points_ppr uses these three columns and so does this ruleset.
      fumblesLost: sumOrNull(r.num("sack_fumbles_lost"), r.num("rushing_fumbles_lost"), r.num("receiving_fumbles_lost")),
      // Passer and receiver on the same conversion are each credited.
      twoPointConversions: sumOrNull(
        r.num("passing_2pt_conversions"),
        r.num("rushing_2pt_conversions"),
        r.num("receiving_2pt_conversions"),
      ),
      specialTeamsTds: r.num("special_teams_tds"),
    };
    rows.push({
      ...key,
      playerId,
      name: r.text("player_display_name") ?? r.text("player_name") ?? playerId,
      team,
      opponent: r.text("opponent_team"),
      position: r.text("position"),
      headshot: r.text("headshot_url"),
      gameId: r.text("game_id"),
      box: {
        completions: r.num("completions"),
        attempts: r.num("attempts"),
        passingYards: offense.passingYards,
        passingTds: offense.passingTds,
        interceptions: offense.interceptions,
        sacksSuffered: r.num("sacks_suffered"),
        carries: r.num("carries"),
        rushingYards: offense.rushingYards,
        rushingTds: offense.rushingTds,
        receptions: offense.receptions,
        receivingYards: offense.receivingYards,
        receivingTds: offense.receivingTds,
      },
      offense,
      score: scoreOffense(offense),
    });
  }
  return { rows, skipped };
}

// stats_team_week_<season>.csv: one row per team per game. Columns without a def_ prefix
// describe the team's own offense and special teams.
export const TEAM_WEEK_COLUMNS = [
  "season",
  "week",
  "team",
  "season_type",
  "game_id",
  "opponent_team",
  "passing_interceptions",
  "sacks_suffered",
  "fumbles_lost_total",
  "passing_tds",
  "rushing_tds",
  "special_teams_tds",
  "def_tds",
  "fumble_recovery_tds",
  "def_safeties",
  "def_2pt_made",
  "def_punt_blocks",
  "def_fg_blocks",
  "def_pat_blocks",
  "pat_made",
  "fg_made",
  "passing_2pt_conversions",
  "rushing_2pt_conversions",
] as const;

type TeamCol = (typeof TEAM_WEEK_COLUMNS)[number];

export type TeamWeek = WeekKey & {
  gameId: string;
  team: string;
  opponent: string;
  /** Given up by this team; the opponent's defense is credited with these. */
  giveaways: {
    /** passing_interceptions: equals the opponent's def_interceptions in every 2025 REG game. */
    interceptionsThrown: number | null;
    /** sacks_suffered: the opponent's def_sacks misses uncredited sacks (lower in 9 of 544 2025 REG team-games). */
    sacksSuffered: number | null;
    /** fumbles_lost_total, including special-teams fumbles; the opponent's fumble_recovery_opp was lower in 3 of 544. */
    fumblesLost: number | null;
  };
  /** Produced by this team's defense and special teams. */
  defense: {
    /**
     * def_tds (interception returns) + fumble_recovery_tds + special_teams_tds. fumble_recovery_tds
     * does not separate own-team recoveries: 1 of 19 in 2025 REG was an offensive recovery TD.
     */
    touchdowns: number | null;
    /** def_safeties + def_2pt_made. */
    twoPointScores: number | null;
    /** def_punt_blocks + def_fg_blocks + def_pat_blocks; equals the opponent's blocked counts in every 2025 REG game. */
    blockedKicks: number | null;
  };
  /** Scoring counts, for cross-checking against the schedule's final score. */
  scoring: {
    offensiveTds: number | null;
    extraPoints: number | null;
    twoPointConversions: number | null;
    fieldGoals: number | null;
    safeties: number | null;
    defensiveTwoPoints: number | null;
  };
};

export function parseTeamWeeks(
  text: string,
  source = "nflverse stats_team_week",
): { rows: TeamWeek[]; skipped: Skipped[] } {
  const table = readCsv(text, TEAM_WEEK_COLUMNS, source);
  const rows: TeamWeek[] = [];
  const skipped: Skipped[] = [];
  for (const r of table.rows) {
    const gameId = r.text("game_id");
    const team = r.text("team");
    const opponent = r.text("opponent_team");
    const key = weekKeyOf<TeamCol>(r, r.text("season_type"), source);
    if (!gameId || !team || !opponent || !key) {
      skipped.push({ line: r.line, reason: "missing game_id, team, opponent_team, season or week" });
      continue;
    }
    rows.push({
      ...key,
      gameId,
      team,
      opponent,
      giveaways: {
        interceptionsThrown: r.num("passing_interceptions"),
        sacksSuffered: r.num("sacks_suffered"),
        fumblesLost: r.num("fumbles_lost_total"),
      },
      defense: {
        touchdowns: sumOrNull(r.num("def_tds"), r.num("fumble_recovery_tds"), r.num("special_teams_tds")),
        twoPointScores: sumOrNull(r.num("def_safeties"), r.num("def_2pt_made")),
        blockedKicks: sumOrNull(r.num("def_punt_blocks"), r.num("def_fg_blocks"), r.num("def_pat_blocks")),
      },
      scoring: {
        offensiveTds: sumOrNull(r.num("passing_tds"), r.num("rushing_tds")),
        extraPoints: r.num("pat_made"),
        twoPointConversions: sumOrNull(r.num("passing_2pt_conversions"), r.num("rushing_2pt_conversions")),
        fieldGoals: r.num("fg_made"),
        safeties: r.num("def_safeties"),
        defensiveTwoPoints: r.num("def_2pt_made"),
      },
    });
  }
  return { rows, skipped };
}

/** The team's points implied by its counting stats, or null when a count is missing. */
export function teamPointsFromCounts(t: TeamWeek): number | null {
  const s = t.scoring;
  const tds = sumOrNull(s.offensiveTds, t.defense.touchdowns);
  if (
    tds == null ||
    s.extraPoints == null ||
    s.twoPointConversions == null ||
    s.fieldGoals == null ||
    s.safeties == null ||
    s.defensiveTwoPoints == null
  ) {
    return null;
  }
  const p = GAME_EVENT_POINTS;
  return (
    tds * p.touchdown +
    s.extraPoints * p.extra_point +
    s.twoPointConversions * p.two_point_conversion +
    s.fieldGoals * p.field_goal +
    s.safeties * p.safety +
    s.defensiveTwoPoints * p.defensive_two_point
  );
}

// nfldata games.csv (what nflreadr::load_schedules reads): one row per game. Scores are NA
// until the game is final.
export const SCHEDULE_COLUMNS = [
  "game_id",
  "season",
  "game_type",
  "week",
  "away_team",
  "away_score",
  "home_team",
  "home_score",
] as const;

type ScheduleCol = (typeof SCHEDULE_COLUMNS)[number];

export type GameResult = WeekKey & {
  gameId: string;
  away: string;
  home: string;
  awayScore: number | null;
  homeScore: number | null;
};

export function parseSchedule(text: string, source = "nfldata games"): { rows: GameResult[]; skipped: Skipped[] } {
  const table = readCsv(text, SCHEDULE_COLUMNS, source);
  const rows: GameResult[] = [];
  const skipped: Skipped[] = [];
  for (const r of table.rows) {
    const gameId = r.text("game_id");
    const away = r.text("away_team");
    const home = r.text("home_team");
    const key = weekKeyOf<ScheduleCol>(r, r.text("game_type"), source);
    if (!gameId || !away || !home || !key) {
      skipped.push({ line: r.line, reason: "missing game_id, teams, season or week" });
      continue;
    }
    rows.push({ ...key, gameId, away, home, awayScore: r.num("away_score"), homeScore: r.num("home_score") });
  }
  return { rows, skipped };
}

/** The opponent's score in this game; null until the schedule has it. */
export function pointsAllowed(game: GameResult, team: string): number | null {
  if (team === game.home) return game.awayScore;
  if (team === game.away) return game.homeScore;
  throw new Error(`${team} is not in ${game.gameId}`);
}

export type DefenseWeek = WeekKey & {
  gameId: string;
  team: string;
  opponent: string;
  stats: DefenseStats;
  score: ScoreResult;
};

/**
 * Team defense per game. Takeaways come from the opponent's giveaway columns and points allowed
 * from the schedule; a missing opponent row or unplayed game leaves those inputs null.
 */
export function defenseWeeks(teams: readonly TeamWeek[], games: readonly GameResult[]): DefenseWeek[] {
  const byGameTeam = new Map(teams.map((t) => [`${t.gameId}|${t.team}`, t]));
  const byGame = new Map(games.map((g) => [g.gameId, g]));
  return teams.map((t) => {
    const opp = byGameTeam.get(`${t.gameId}|${t.opponent}`);
    const game = byGame.get(t.gameId);
    const stats: DefenseStats = {
      sacks: opp ? opp.giveaways.sacksSuffered : null,
      interceptions: opp ? opp.giveaways.interceptionsThrown : null,
      fumbleRecoveries: opp ? opp.giveaways.fumblesLost : null,
      touchdowns: t.defense.touchdowns,
      twoPointScores: t.defense.twoPointScores,
      blockedKicks: t.defense.blockedKicks,
      pointsAllowed: game ? pointsAllowed(game, t.team) : null,
    };
    return {
      season: t.season,
      seasonType: t.seasonType,
      week: t.week,
      gameId: t.gameId,
      team: t.team,
      opponent: t.opponent,
      stats,
      score: scoreDefense(stats),
    };
  });
}
