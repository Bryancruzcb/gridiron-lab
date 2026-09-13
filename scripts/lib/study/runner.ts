// Evaluation runner: one common slate per week, strict solver calls with the method requested,
// the method used and the status recorded per model and week, and one documented set of common
// weeks for every model.

import type {
  FantasyPlayer,
  StudyInputIdentity,
  StudyLineupRecord,
  StudyModelWeek,
  StudyOffSlate,
  StudyRole,
  StudyRun,
  StudyRunArtifact,
  StudySlatePlayer,
  StudySolverMethod,
  StudySolverRecord,
  StudyUniverse,
  StudyWeekExclusion,
  StudyWeekRecord,
} from "../../../src/data/types.ts";
import { solveLineup, type SolveRequest, type SolveResult } from "../../../src/lib/optimizer.ts";
import { StudyConfigError } from "./errors.ts";
import { hashJson } from "./hash.ts";
import { LEGACY_SCORING_REF } from "./legacy-scoring.ts";
import { validateModelConfig, type ModelConfig } from "./models.ts";
import { checkScoringRef, type DefenseRow, type PlayerRow, type PreparedSeason, type ScheduledGame } from "./prepare.ts";
import { buildFeatures, historyGames, project, snapshotBefore, type Cutoff } from "./projections.ts";
import { runIdOf, sealRun, summarizeWeeks } from "./report.ts";
import { ROUNDING, round, sum } from "./stats.ts";
import { universeRef } from "./universe.ts";

/** @2: model specs carry a versioned definition, and the opponent factor compares one population (opp@2). */
export const STUDY_PIPELINE_REF = "gridiron-lab-study-pipeline@2";
/** The Task 1 solveLineup contract. Bump when the optimizer can return a different lineup for the same input. */
export const STUDY_SOLVER_REF = "gridiron-lab-solveLineup@1";

export const STUDY_POLICIES: readonly string[] = [
  "Cutoff: a week-w forecast reads only rows with (season, week) before (S, w) and schedule scores of earlier weeks; history is ordered by season, week, game id.",
  "Position priors, opponent features and recency models read the same pre-cutoff snapshot; the position prior falls back to positionPriorFallback when the pool has no history (or a mean of exactly 0).",
  "Opponent factor: mean points of every pre-cutoff source row at the position (defense rows for DST) against the scheduled opponent, divided by the mean of those same rows against every opponent; 1 when either side has no rows. The pool's position mean is used only as the shrink prior.",
  "Scheduled opponents come from the schedule, for the player's latest team before the cutoff (else the universe team), never from a postgame row.",
  "Slate: universe players whose team has a game in week w and who have at least minHistoryGames scored games before the cutoff. A missing postgame row never removes a player.",
  "Actuals: played = a scored stat row (a zero is kept); inactive = final game, source covers the week, no row: 0 in a lineup, left out of player error; not-final, missing-source and unknown-identity stay missing.",
  "Unscored rows (a required stat or points allowed missing) are excluded from history and missing as actuals; nothing is filled with zero or 24 points allowed.",
  "Strict solver: each model calls solveLineup once with its method; a non-ok result, or an ok result from another method (or a heuristic exact-dp result), invalidates the week. No fallback.",
  "Common weeks: a week counts only when every model solved and every lineup actual is complete; all summaries use that set and excluded weeks keep their reasons.",
  "Player error: slate player-weeks with status played over the common weeks, using the stored projections and actuals.",
  "Uncertainty: percentile bootstrap of the mean paired weekly lineup difference, resampling weeks with replacement (the week is the unit, lineup players are not independent). Descriptive, not a significance test.",
  "unknown-identity on the off-slate list is a label from the whole season's sources; it never changes eligibility.",
];

export type StudyRunConfig = {
  season: number;
  weeks: { from: number; to: number };
  role: StudyRole;
  scoring: string;
  models: ModelConfig;
  minHistoryGames: number;
  positionPriorFallback: number;
  uncertainty: { resamples: number; seed: number; level: number };
  /** Runs a universe frozen for another season: a common-pool experiment, disclosed in the policies. */
  allowUniverseSeasonMismatch?: boolean;
};

export const DEFAULT_RUN_SETTINGS = {
  minHistoryGames: 1,
  positionPriorFallback: 8,
  uncertainty: { resamples: 2000, seed: 20260912, level: 0.95 },
} as const;

export type RunStudyInput = {
  config: StudyRunConfig;
  data: PreparedSeason;
  universe: StudyUniverse;
  /** Identities of every file behind data and universe. */
  inputs: readonly StudyInputIdentity[];
  /** Defaults to solveLineup; tests inject failures. */
  solve?: (request: SolveRequest) => SolveResult;
};

const ROLES: readonly StudyRole[] = ["development", "holdout", "retrospective"];

function checkConfig(input: RunStudyInput): ModelConfig {
  const { config, data, universe } = input;
  checkScoringRef(config.scoring);
  if (data.season !== config.season) throw new StudyConfigError(`prepared season ${data.season} is not the run season ${config.season}`);
  if (data.scoring !== config.scoring) throw new StudyConfigError(`data was prepared with ${data.scoring}, the run asks for ${config.scoring}`);
  if (universe.season !== config.season && !config.allowUniverseSeasonMismatch) {
    throw new StudyConfigError(
      `universe ${universe.id} was frozen for ${universe.season}, not ${config.season}; allowUniverseSeasonMismatch runs it as a disclosed common-pool experiment`,
    );
  }
  const { from, to } = config.weeks;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 22 || from > to) {
    throw new StudyConfigError(`week range ${from}-${to} must satisfy 1 <= from <= to <= 22`);
  }
  if (!ROLES.includes(config.role)) throw new StudyConfigError(`role must be one of ${ROLES.join(", ")}`);
  if (!Number.isInteger(config.minHistoryGames) || config.minHistoryGames < 1) {
    throw new StudyConfigError("minHistoryGames must be a whole number >= 1");
  }
  if (!Number.isFinite(config.positionPriorFallback)) throw new StudyConfigError("positionPriorFallback must be finite");
  const u = config.uncertainty;
  if (!Number.isInteger(u.resamples) || u.resamples < 100 || !Number.isInteger(u.seed) || u.seed < 0 || u.seed > 0xffffffff || !(u.level > 0 && u.level < 1)) {
    throw new StudyConfigError("uncertainty needs resamples >= 100, a 32-bit unsigned seed and 0 < level < 1");
  }
  const ids = new Set<string>();
  for (const i of input.inputs) {
    if (ids.has(i.id)) throw new StudyConfigError(`input ${i.id} is listed twice`);
    ids.add(i.id);
  }
  return validateModelConfig(config.models, "model config");
}

function buildRun(input: RunStudyInput, models: ModelConfig): StudyRun {
  const { config, universe } = input;
  const commonPool = universe.season !== config.season;
  return {
    pipeline: STUDY_PIPELINE_REF,
    season: config.season,
    seasonType: "REG",
    weeks: { from: config.weeks.from, to: config.weeks.to },
    role: config.role,
    scoring: { ref: config.scoring, legacyAttributionOnly: config.scoring === LEGACY_SCORING_REF },
    solver: { api: "solveLineup", ref: STUDY_SOLVER_REF, cap: universe.cap, strict: true },
    universe: universeRef(universe),
    models: models.models,
    baselineModel: models.baseline,
    minHistoryGames: config.minHistoryGames,
    positionPriorFallback: config.positionPriorFallback,
    uncertainty: {
      method: "paired-week-bootstrap-percentile",
      resamples: config.uncertainty.resamples,
      seed: config.uncertainty.seed,
      level: config.uncertainty.level,
    },
    policies: [
      ...STUDY_POLICIES,
      ...(commonPool
        ? [`Common-pool experiment: a universe frozen for ${universe.season} evaluated on ${config.season}; its selection reflects another season.`]
        : []),
    ],
    inputs: [...input.inputs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

type Actual = Pick<StudySlatePlayer, "status" | "points" | "note">;

function playerActual(
  row: PlayerRow | undefined,
  scheduled: ScheduledGame,
  gameById: ReadonlyMap<string, ScheduledGame>,
  statCovers: boolean,
  week: number,
): Actual {
  if (row) {
    const game = (row.gameId && gameById.get(row.gameId)) || scheduled;
    if (!game.final) return { status: "not-final", points: null, note: null };
    if (row.points == null) return { status: "missing-source", points: null, note: `score missing: ${row.missing.join(", ")}` };
    return { status: "played", points: row.points, note: row.status === "partial" ? `unavailable: ${row.missing.join(", ")}` : null };
  }
  if (!scheduled.final) return { status: "not-final", points: null, note: null };
  if (!statCovers) return { status: "missing-source", points: null, note: `player-week source has no week ${week} rows` };
  return { status: "inactive", points: null, note: "final game, no stat row" };
}

function defenseActual(row: DefenseRow | undefined, scheduled: ScheduledGame, gameById: ReadonlyMap<string, ScheduledGame>): Actual {
  const game = (row?.gameId && gameById.get(row.gameId)) || scheduled;
  if (!game.final) return { status: "not-final", points: null, note: null };
  if (!row) return { status: "missing-source", points: null, note: "no team-week row for a final game" };
  if (row.points == null) return { status: "missing-source", points: null, note: `score missing: ${row.missing.join(", ")}` };
  return { status: "played", points: row.points, note: row.status === "partial" ? `unavailable: ${row.missing.join(", ")}` : row.note };
}

function recordSolve(
  requested: StudySolverMethod,
  result: SolveResult,
  slate: readonly StudySlatePlayer[],
  projections: readonly number[],
  index: ReadonlyMap<string, number>,
): { solver: StudySolverRecord; lineup: StudyLineupRecord | null } {
  if (result.status !== "ok") {
    return {
      solver: { requested, used: null, status: result.status, code: result.code, optimality: null, message: result.message },
      lineup: null,
    };
  }
  if (result.method !== requested || (requested === "exact-dp" && result.optimality !== "proven")) {
    return {
      solver: {
        requested,
        used: result.method,
        status: "error",
        code: "method-mismatch",
        optimality: result.optimality,
        message: `requested ${requested}, got ${result.method} (${result.optimality}); strict runs accept no substitute`,
      },
      lineup: null,
    };
  }
  const slots = result.lineup.slots.map(({ slot, player }) => {
    const i = index.get(player.id);
    if (i == null) throw new Error(`solver returned ${player.id}, which is not on the slate`);
    const s = slate[i]!;
    return { slot, id: s.id, pos: s.pos, team: s.team, salary: s.salary, proj: projections[i]!, status: s.status, points: s.points };
  });
  const missing = slots.filter((x) => x.status !== "played" && x.status !== "inactive").map((x) => x.id);
  return {
    solver: { requested, used: result.method, status: "ok", code: null, optimality: result.optimality, message: result.fallbackReason ?? null },
    lineup: {
      slots,
      salary: sum(slots.map((x) => x.salary)),
      proj: round(sum(slots.map((x) => x.proj)), ROUNDING.projection),
      actual: missing.length ? null : round(sum(slots.map((x) => x.points ?? 0)), ROUNDING.points),
      missing,
    },
  };
}

export function runStudy(input: RunStudyInput): StudyRunArtifact {
  const models = checkConfig(input);
  const { config, data } = input;
  const universe = { ...input.universe, players: [...input.universe.players].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
  const solve = input.solve ?? solveLineup;
  const run = buildRun({ ...input, universe }, models);

  const gameById = new Map(data.games.map((g) => [g.gameId, g]));
  const playerAt = new Map(data.players.map((r) => [`${r.week}|${r.playerId}`, r]));
  const defenseAt = new Map(data.defenses.map((r) => [`${r.week}|${r.team}`, r]));
  const seasonPlayers = new Set(data.players.map((r) => r.playerId));
  const seasonTeams = new Set(data.games.flatMap((g) => [g.away, g.home]));
  const names = new Map(universe.players.map((p) => [p.id, p.name]));

  const weeks: StudyWeekRecord[] = [];
  for (let w = config.weeks.from; w <= config.weeks.to; w++) {
    const cutoff: Cutoff = { season: config.season, seasonType: "REG", beforeWeek: w };
    const snapshot = snapshotBefore(data, cutoff);
    const features = buildFeatures(snapshot, universe.players, config.positionPriorFallback);
    const pregameByTeam = new Map<string, ScheduledGame>();
    for (const g of snapshot.games) {
      if (g.week !== w) continue;
      pregameByTeam.set(g.away, g);
      pregameByTeam.set(g.home, g);
    }
    const statCovers = data.statWeeks.includes(w);

    const slate: StudySlatePlayer[] = [];
    const offSlate: StudyOffSlate[] = [];
    for (const p of universe.players) {
      const team = p.pos === "DST" ? p.team : (snapshot.latestTeam.get(p.id) ?? p.team);
      const known = p.pos === "DST" ? seasonTeams.has(p.team) : seasonPlayers.has(p.id);
      const pregame = pregameByTeam.get(team);
      if (!pregame) {
        offSlate.push({ id: p.id, reason: known ? "bye" : "unknown-identity" });
        continue;
      }
      const games = historyGames(snapshot, { id: p.id, pos: p.pos, team });
      if (games < config.minHistoryGames) {
        offSlate.push({ id: p.id, reason: known ? "no-history" : "unknown-identity" });
        continue;
      }
      const scheduled = gameById.get(pregame.gameId)!;
      const actual =
        p.pos === "DST"
          ? defenseActual(defenseAt.get(`${w}|${team}`), scheduled, gameById)
          : playerActual(playerAt.get(`${w}|${p.id}`), scheduled, gameById, statCovers, w);
      slate.push({
        id: p.id,
        pos: p.pos,
        team,
        opponent: pregame.away === team ? pregame.home : pregame.away,
        gameId: pregame.gameId,
        salary: p.salary,
        historyGames: games,
        ...actual,
      });
    }

    const exclusions: StudyWeekExclusion[] = [];
    const modelWeeks: StudyModelWeek[] = [];
    if (!slate.length) {
      exclusions.push({
        reason: "empty-slate",
        model: null,
        detail: `no universe player has a game and ${config.minHistoryGames}+ scored games before week ${w}`,
      });
    } else {
      const index = new Map(slate.map((s, i) => [s.id, i]));
      for (const model of models.models) {
        const projections = slate.map((s) => {
          const x = project(model, { id: s.id, pos: s.pos, team: s.team, opponent: s.opponent }, snapshot, features);
          if (!Number.isFinite(x)) throw new Error(`model ${model.id} projected a non-finite value for ${s.id} in week ${w}`);
          return round(x, ROUNDING.projection);
        });
        const pool: FantasyPlayer[] = slate.map((s, i) => ({
          id: s.id,
          name: names.get(s.id) ?? s.id,
          pos: s.pos,
          team: s.team,
          headshot: null,
          games: s.historyGames,
          ppr: null,
          ppg: projections[i]!,
          proj: projections[i]!,
          recencyPpg: projections[i]!,
          salary: s.salary,
        }));
        const { solver, lineup } = recordSolve(model.solver, solve({ players: pool, cap: universe.cap, method: model.solver }), slate, projections, index);
        if (solver.status !== "ok") {
          exclusions.push({ reason: "solver-failed", model: model.id, detail: `${solver.requested}: ${solver.status}/${solver.code}` });
        } else if (lineup && lineup.actual == null) {
          exclusions.push({
            reason: "lineup-actual-incomplete",
            model: model.id,
            detail: lineup.missing.map((id) => `${id} ${slate[index.get(id)!]!.status}`).join(", "),
          });
        }
        modelWeeks.push({ model: model.id, projections, solver, lineup });
      }
    }

    weeks.push({
      season: config.season,
      seasonType: "REG",
      week: w,
      cutoff,
      games: data.games.filter((g) => g.week === w).map((g) => ({ gameId: g.gameId, away: g.away, home: g.home, final: g.final })),
      statSourceCoversWeek: statCovers,
      slate,
      slateSha256: hashJson(
        slate.map(({ id, pos, team, opponent, gameId, salary, historyGames }) => ({ id, pos, team, opponent, gameId, salary, historyGames })),
      ),
      offSlate,
      models: modelWeeks,
      comparable: exclusions.length === 0,
      exclusions,
    });
  }

  const summary = summarizeWeeks(weeks, models.models, models.baseline, run.uncertainty);
  return sealRun({ schemaVersion: "gridiron-lab-study-run@1", runId: runIdOf(run), run, weeks, summary });
}
