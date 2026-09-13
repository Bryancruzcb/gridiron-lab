export type SplitStats = {
  plays: number;
  epa: number | null;
  success: number | null;
  cpoe: number | null;
  comp: number | null;
  press: number | null;
  sack: number | null;
  td: number;
  int: number;
  ypa: number | null;
  att: number;
  air: number | null;
};

export type QbBox = {
  games: number;
  cmp: number;
  att: number;
  yds: number;
  td: number;
  int: number;
  sk: number;
  rushYds: number;
  rushTd: number;
  ppr: number | null;
};

export type QbWeekPoint = {
  week: number;
  plays: number;
  epa: number | null;
  cpoe: number | null;
};

export type QbSeason = {
  id: string;
  name: string;
  team: string;
  season: number;
  games: number;
  headshot: string | null;
  box: QbBox | null;
  overall: SplitStats;
  splits: Record<string, SplitStats>;
  weeks?: QbWeekPoint[];
};

export type QbFile = {
  source: string;
  seasons: number[];
  qbs: QbSeason[];
};

export type TeamMeta = {
  city: string;
  name: string;
  color: string;
};

export type PlaySplit = {
  plays: number;
  passRate: number | null;
  epa: number | null;
  success: number | null;
  xpass: number | null;
  proe: number | null;
};

export type TeamSeason = {
  season: number;
  team: string;
  coach: string | null;
  plays: number;
  passRate: number | null;
  epa: number | null;
  success: number | null;
  shotgun: number | null;
  noHuddle: number | null;
  proe: number | null;
  secondAndShort: {
    plays: number;
    passRate: number | null;
    epaPass: number | null;
    epaRush: number | null;
    successPass: number | null;
    successRush: number | null;
  };
  fourthDown: {
    opps: number;
    goRate: number | null;
    puntRate: number | null;
    fgRate: number | null;
    convertRate: number | null;
    goEpa: number | null;
    neutralGoRate: number | null;
  };
  splits: Record<string, PlaySplit>;
};

export type PlaycallingFile = {
  source: string;
  seasons: number[];
  teams: TeamSeason[];
  teamMeta: Record<string, TeamMeta>;
};

export type FantasyPos = "QB" | "RB" | "WR" | "TE" | "DST";

export type FantasyPlayer = {
  id: string;
  name: string;
  pos: FantasyPos;
  team: string;
  headshot: string | null;
  games: number;
  ppr: number | null;
  ppg: number;
  proj: number;
  recencyPpg: number;
  salary: number;
  passYds?: number;
  passTd?: number;
  rushYds?: number;
  rushTd?: number;
  rec?: number;
  recYds?: number;
  recTd?: number;
  sacks?: number;
  ints?: number;
  tds?: number;
};

export type FantasyFile = {
  source: string;
  season: number;
  scoring: string;
  cap: number;
  roster: Record<string, number>;
  players: FantasyPlayer[];
};

export type StudyLineupScore = {
  proj: number;
  actual: number;
  salary: number;
};

export type StudyWeek = {
  week: number;
  players: number;
  exact: StudyLineupScore;
  greedyProj: StudyLineupScore;
  greedyValue: StudyLineupScore;
};

export type StudySummary = {
  weeks: number;
  exactMean: number;
  exactMedian: number;
  greedyProjMean: number;
  greedyValueMean: number;
  exactBeatsProj: number;
  exactBeatsValue: number;
};

export type BacktestFile = {
  source: string;
  season: number;
  cap: number;
  notes: string[];
  weeks: StudyWeek[];
  summary: StudySummary;
};

export type QbLagPoint = {
  id: string;
  name: string;
  team: string;
  week: number;
  epaPrev: number;
  epaNext: number;
  cpoePrev: number | null;
  cpoeNext: number | null;
  attPrev: number;
  attNext: number;
};

export type QbLagFile = {
  source: string;
  season: number;
  minAttempts: number;
  n: number;
  corrEpa: number | null;
  corrCpoe: number | null;
  pairs: QbLagPoint[];
};

export type ProjectionModel = {
  id: string;
  label: string;
  mae: number;
  rmse: number;
  n: number;
  lineupMean: number;
  lineupMedian: number;
  weeks: number;
};

export type ProjectionFile = {
  source: string;
  season: number;
  notes: string[];
  models: ProjectionModel[];
};

export type EwmaPoint = {
  alpha: number;
  mae: number;
  rmse: number;
  n: number;
  lineupMean: number;
  lineupMedian: number;
  weeks: number;
};

export type EwmaFile = {
  source: string;
  season: number;
  note: string;
  trail: Omit<EwmaPoint, "alpha">;
  points: EwmaPoint[];
  bestLineup: { alpha: number; lineupMean: number; mae: number };
  bestMae: { alpha: number; mae: number; lineupMean: number };
};

// Versioned study artifacts written by scripts/study.ts (scripts/lib/study). The legacy
// Backtest/Projection/Ewma file types above stay until the study page migrates.

export type StudySolverMethod = "exact-dp" | "hill-climb" | "greedy-proj" | "greedy-value";

export type StudyInputRole = "player-week" | "team-week" | "schedule" | "universe-file";

/** A source file as it enters the semantic run identity: the bytes' hash, not just a URL. */
export type StudyInputIdentity = {
  id: string;
  role: StudyInputRole;
  /** null for multi-season files such as the schedule. */
  season: number | null;
  url: string;
  sha256: string;
  bytes: number;
  schema: {
    /** The parser contract the file was checked against. */
    id: string;
    /** CSV only: sha256 of the normalized header names joined with commas. */
    headerSha256: string | null;
    columns: number | null;
    requiredColumns: string[];
  };
};

/** Cache manifest entry: identity plus where and when the bytes were stored (operational). */
export type StudyInputManifestEntry = StudyInputIdentity & {
  /** Fetched inputs: relative to the cache directory. Local files: repo-relative, else absolute. */
  localPath: string;
  retrievedAt: string;
  http: { etag: string | null; lastModified: string | null } | null;
};

export type StudyUniversePlayer = {
  id: string;
  name: string;
  pos: FantasyPos;
  /** Team when the universe was frozen; weekly slates use the latest team seen before the cutoff. */
  team: string;
  salary: number;
};

export type SyntheticUniverseParams = {
  fromSeason: number;
  minGames: number;
  counts: Record<FantasyPos, number>;
  /** Inclusive [lowest, highest] salary per position, mapped linearly from prior-season points per game. */
  salaryBands: Record<FantasyPos, [number, number]>;
  salaryStep: number;
  scoring: string;
};

/** A frozen player pool with synthetic salaries; its canonical JSON hash identifies it. */
export type StudyUniverse = {
  schemaVersion: "gridiron-lab-study-universe@1";
  id: string;
  rule: "legacy-fantasy-json" | "synthetic-prior-season@1";
  season: number;
  cap: number;
  description: string;
  /** Plain statement of the information the selection and salaries used. */
  informationCutoff: string;
  /** True when selection or salaries used information from the season being evaluated. */
  lookAhead: boolean;
  params: SyntheticUniverseParams | null;
  sourceInputs: { id: string; sha256: string }[];
  /** Sorted by id. */
  players: StudyUniversePlayer[];
};

export type StudyUniverseRef = {
  id: string;
  rule: StudyUniverse["rule"];
  season: number;
  sha256: string;
  players: number;
  lookAhead: boolean;
};

export type StudyProjectionMethod = "trail" | "last1" | "last3" | "blend" | "ewma" | "shrink" | "usage" | "opp";

export type StudyModelSpec = {
  id: string;
  label: string;
  method: StudyProjectionMethod;
  /** Versioned definition of the method, such as "opp@2"; part of the run id (see METHOD_DEFINITIONS). */
  definition: string;
  /** Method parameters; each method accepts a fixed set of names (see scripts/lib/study/models.ts). */
  params: Record<string, number>;
  solver: StudySolverMethod;
};

export type StudyRole = "development" | "holdout" | "retrospective";

/** Everything that determines results. Its canonical hash is the run id. */
export type StudyRun = {
  pipeline: string;
  season: number;
  seasonType: "REG";
  weeks: { from: number; to: number };
  role: StudyRole;
  scoring: { ref: string; legacyAttributionOnly: boolean };
  solver: { api: "solveLineup"; ref: string; cap: number; strict: true };
  universe: StudyUniverseRef;
  models: StudyModelSpec[];
  baselineModel: string;
  minHistoryGames: number;
  positionPriorFallback: number;
  uncertainty: { method: "paired-week-bootstrap-percentile"; resamples: number; seed: number; level: number };
  policies: string[];
  /** Sorted by id. */
  inputs: StudyInputIdentity[];
};

/**
 * played: a stat row exists (a real zero is played with 0 points)
 * inactive: the team's game is final and the source covers the week, but the player has no row
 * bye: the team has no game this week (not on the slate)
 * not-final: the scheduled game has no final score yet
 * missing-source: the game is final but the source row, a required stat or the week is absent
 * unknown-identity: the id never appears in the season's sources
 */
export type StudyAvailability = "played" | "inactive" | "bye" | "not-final" | "missing-source" | "unknown-identity";

export type StudySlatePlayer = {
  id: string;
  pos: FantasyPos;
  /** Latest team before the cutoff, else the universe team. */
  team: string;
  /** From the schedule, never from a postgame row. */
  opponent: string;
  gameId: string;
  salary: number;
  historyGames: number;
  status: StudyAvailability;
  /** Actual points when played; null otherwise. */
  points: number | null;
  note: string | null;
};

export type StudyOffSlate = { id: string; reason: "bye" | "no-history" | "unknown-identity" };

export type StudySolverRecord = {
  requested: StudySolverMethod;
  used: StudySolverMethod | null;
  status: "ok" | "invalid-input" | "infeasible" | "error";
  code: string | null;
  optimality: "proven" | "heuristic" | null;
  message: string | null;
};

export type StudyLineupSlot = {
  slot: string;
  id: string;
  pos: FantasyPos;
  team: string;
  salary: number;
  proj: number;
  status: StudyAvailability;
  points: number | null;
};

export type StudyLineupRecord = {
  slots: StudyLineupSlot[];
  salary: number;
  proj: number;
  /** Sum over slots (inactive counts 0); null when any slot's actual is unavailable. */
  actual: number | null;
  /** Slot ids whose actual is not-final, missing-source or unknown-identity. */
  missing: string[];
};

export type StudyModelWeek = {
  model: string;
  /** Aligned with the week's slate order; exactly the values the solver received. */
  projections: number[];
  solver: StudySolverRecord;
  lineup: StudyLineupRecord | null;
};

export type StudyWeekExclusion = {
  reason: "empty-slate" | "solver-failed" | "lineup-actual-incomplete";
  model: string | null;
  detail: string;
};

export type StudyWeekRecord = {
  season: number;
  seasonType: "REG";
  week: number;
  /** Forecasts use rows strictly before (season, beforeWeek) and schedule scores of earlier weeks. */
  cutoff: { season: number; seasonType: "REG"; beforeWeek: number };
  games: { gameId: string; away: string; home: string; final: boolean }[];
  /** Whether the player-week source has any row for this week. */
  statSourceCoversWeek: boolean;
  /** Sorted by id. */
  slate: StudySlatePlayer[];
  /** Hash of the pregame slate (ids, positions, teams, opponents, games, salaries, history counts). */
  slateSha256: string;
  /** Sorted by id. */
  offSlate: StudyOffSlate[];
  /** Same order as run.models. */
  models: StudyModelWeek[];
  comparable: boolean;
  exclusions: StudyWeekExclusion[];
};

export type StudyPlayerError = {
  /** Slate player-weeks with status played, over the common weeks. */
  n: number;
  mae: number | null;
  rmse: number | null;
  /** Mean of projection minus actual. */
  bias: number | null;
};

export type StudyModelSummary = {
  model: string;
  label: string;
  solver: StudySolverMethod;
  /** Weeks in range where this model solved and its lineup actual was complete. */
  validWeeks: number;
  /** Common weeks used for every number below. */
  weeks: number;
  lineupActualMean: number | null;
  lineupActualMedian: number | null;
  lineupProjMean: number | null;
  playerError: StudyPlayerError;
};

export type StudyPairedComparison = {
  model: string;
  baseline: string;
  /** Number of paired weeks (model actual minus baseline actual). */
  n: number;
  meanDiff: number | null;
  medianDiff: number | null;
  wins: number;
  losses: number;
  ties: number;
  interval: { level: number; low: number; high: number } | null;
};

export type StudyWeekRef = { season: number; week: number };

export type StudyRunSummary = {
  commonWeeks: StudyWeekRef[];
  excludedWeeks: (StudyWeekRef & { exclusions: StudyWeekExclusion[] })[];
  rounding: { projection: number; points: number; summary: number };
  models: StudyModelSummary[];
  paired: StudyPairedComparison[];
};

export type StudyRunArtifact = {
  schemaVersion: "gridiron-lab-study-run@1";
  runId: string;
  run: StudyRun;
  weeks: StudyWeekRecord[];
  summary: StudyRunSummary;
  /** sha256 of the canonical JSON of everything above. */
  resultSha256: string;
};

/** Operational metadata, kept out of every semantic hash. */
export type StudyRunMeta = {
  schemaVersion: "gridiron-lab-study-run-meta@1";
  runId: string;
  resultSha256: string;
  generatedAt: string;
  elapsedMs: number;
  sourceCommit: string | null;
  sourceDirty: boolean | null;
  node: string;
  command: string[];
  /** LF-normalized sha256 of the code that produced the result. */
  codeSha256: Record<string, string>;
  cacheDir: string;
  inputs: StudyInputManifestEntry[];
  warnings: string[];
};

export type StudyMultiSeasonArtifact = {
  schemaVersion: "gridiron-lab-study-multi@1";
  runs: { season: number; runId: string; resultSha256: string; role: StudyRole; commonWeeks: number }[];
  /** sha256 of the canonical model list shared by every run. */
  modelsSha256: string;
  baselineModel: string;
  uncertainty: StudyRun["uncertainty"];
  /** Pooled over every run's common weeks, with (season, week) as the unit. */
  pooled: StudyRunSummary;
  resultSha256: string;
};

export type StudyQbLagArtifact = QbLagFile & {
  schemaVersion: "gridiron-lab-study-qb-lag@1";
  inputs: StudyInputIdentity[];
  resultSha256: string;
};

/** One season run as published for the study page: its stored summary plus weekly lineup totals. */
export type StudySeasonRow = {
  season: number;
  role: StudyRole;
  runId: string;
  resultSha256: string;
  universe: StudyUniverseRef;
  cap: number;
  weeks: { from: number; to: number };
  summary: StudyRunSummary;
  /** Common weeks only; lineup projection and actual keyed by model id. */
  weekly: { week: number; slate: number; lineups: Record<string, { proj: number; actual: number }> }[];
  qbLag: { n: number; minAttempts: number; corrEpa: number | null; corrCpoe: number | null; resultSha256: string } | null;
};

export type StudySeasonPool = {
  seasons: number[];
  roles: StudyRole[];
  runIds: string[];
  /** resultSha256 of the multi-season artifact the pool summarizes. */
  resultSha256: string;
  summary: StudyRunSummary;
};

/** src/data/study-seasons.json, written by `npm run study:build -- publish`. */
export type StudySeasonsFile = {
  schemaVersion: "gridiron-lab-study-seasons@1";
  pipeline: string;
  scoring: string;
  solver: string;
  models: StudyModelSpec[];
  baselineModel: string;
  uncertainty: StudyRun["uncertainty"];
  minHistoryGames: number;
  policies: string[];
  /** One locked configuration and one universe rule, sorted by season. */
  seasons: StudySeasonRow[];
  /** The development seasons pooled (when some seasons are not development), then every season. */
  pools: StudySeasonPool[];
  /** The shipped fantasy.json slate run, kept for continuity; its pool and salaries use look-ahead. */
  shippedSlate: StudySeasonRow | null;
  resultSha256: string;
};

/** docs/study/input-manifest.json: every input behind the published runs, by content hash. */
export type StudyInputManifestFile = {
  schemaVersion: "gridiron-lab-study-input-manifest@1";
  cache: string;
  inputs: (StudyInputManifestEntry & { usedBy: string[] })[];
};


