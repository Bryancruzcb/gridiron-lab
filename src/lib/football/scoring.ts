// The project's fantasy scoring rules. Pure: providers normalize their own columns into
// OffenseStats / DefenseStats first, then these functions apply one versioned ruleset.

export const RULESET = {
  id: "gridiron-lab-ppr-dst",
  version: 1,
  name: "Gridiron Lab PPR + DST",
  description:
    "The project's simplified DraftKings-inspired PPR and team-defense ruleset, not exact platform scoring. " +
    "Offense uses standard PPR weights (the weights behind nflverse fantasy_points_ppr): no yardage bonuses, " +
    "interceptions and fumbles lost cost 2 points. Team defense uses DraftKings-style event points and " +
    "points-allowed tiers, where points allowed is simply the opponent's final game score, including points " +
    "the opponent's defense or special teams scored.",
  offense: {
    passingYards: 0.04,
    passingTds: 4,
    interceptions: -2,
    rushingYards: 0.1,
    rushingTds: 6,
    receptions: 1,
    receivingYards: 0.1,
    receivingTds: 6,
    fumblesLost: -2,
    twoPointConversions: 2,
    specialTeamsTds: 6,
  },
  defense: {
    sacks: 1,
    interceptions: 2,
    fumbleRecoveries: 2,
    touchdowns: 6,
    twoPointScores: 2,
    blockedKicks: 2,
  },
  /** Inclusive ranges of the opponent's final score. */
  pointsAllowedTiers: [
    { min: 0, max: 0, points: 10 },
    { min: 1, max: 6, points: 7 },
    { min: 7, max: 13, points: 4 },
    { min: 14, max: 20, points: 1 },
    { min: 21, max: 27, points: 0 },
    { min: 28, max: 34, points: -1 },
    { min: 35, max: null, points: -4 },
  ],
} as const;

export const RULESET_REF = `${RULESET.id}@${RULESET.version}`;

export type OffenseStat = keyof typeof RULESET.offense;
export type DefenseStat = keyof typeof RULESET.defense;

// Required inputs must be present or the line cannot be scored. Supplementary inputs may be
// absent from a source; the result then names them instead of hiding the gap.
export const OFFENSE_REQUIRED = [
  "passingYards",
  "passingTds",
  "interceptions",
  "rushingYards",
  "rushingTds",
  "receptions",
  "receivingYards",
  "receivingTds",
] as const satisfies readonly OffenseStat[];

export const DEFENSE_REQUIRED = [
  "sacks",
  "interceptions",
  "fumbleRecoveries",
  "touchdowns",
] as const satisfies readonly DefenseStat[];

/**
 * One player's game. null means the source did not provide the value; zero is a real zero.
 * fumblesLost: fumbles lost by the player. specialTeamsTds: return and other special-teams touchdowns.
 */
export type OffenseStats = Record<OffenseStat, number | null>;

/**
 * One team defense/special teams unit's game. null means the source did not provide the value.
 * - sacks: sacks of the opponent's passers (half sacks allowed)
 * - interceptions: passes intercepted from the opponent
 * - fumbleRecoveries: opponent fumbles recovered (the opponent's fumbles lost)
 * - touchdowns: defensive and special-teams touchdowns scored by the unit's team
 * - twoPointScores: safeties plus returned PAT or two-point tries, 2 points each
 * - blockedKicks: punts, field goals and PATs blocked
 * - pointsAllowed: the opponent's game score (final, or current while live)
 */
export type DefenseStats = Record<DefenseStat, number | null> & { pointsAllowed: number | null };

export type ScoreResult =
  | { status: "complete"; points: number }
  | { status: "partial"; points: number; unavailable: string[] }
  | { status: "missing"; missing: string[] };

/** Scores whose points can be shown: complete, or partial with the gaps listed. */
export type Scored = Exclude<ScoreResult, { status: "missing" }>;

export function isScored(r: ScoreResult): r is Scored {
  return r.status !== "missing";
}

/** What a displayed score carries alongside its points. */
export type ScoreMeta = { status: Scored["status"]; unavailable: string[] };

export function scoreMeta(r: Scored): ScoreMeta {
  return { status: r.status, unavailable: r.status === "partial" ? r.unavailable : [] };
}

export function roundPoints(x: number): number {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r;
}

// Yards may be negative and sacks may be split; every other count is a whole number >= 0.
const SIGNED = new Set<string>(["passingYards", "rushingYards", "receivingYards"]);
const HALVES = new Set<string>(["sacks"]);

function checkValue(name: string, v: number) {
  if (!Number.isFinite(v)) throw new RangeError(`${name} must be a finite number, got ${v}`);
  if (SIGNED.has(name)) return;
  if (v < 0) throw new RangeError(`${name} cannot be negative, got ${v}`);
  const step = HALVES.has(name) ? v * 2 : v;
  if (!Number.isInteger(step)) {
    throw new RangeError(`${name} must be a ${HALVES.has(name) ? "multiple of 0.5" : "whole number"}, got ${v}`);
  }
}

function applyWeights<K extends string>(
  stats: Record<K, number | null>,
  weights: Record<K, number>,
  required: readonly K[],
  base: number,
): ScoreResult {
  const missing = required.filter((k) => stats[k] == null);
  if (missing.length) return { status: "missing", missing };
  let total = base;
  const unavailable: string[] = [];
  for (const k of Object.keys(weights) as K[]) {
    const v = stats[k];
    if (v == null) {
      unavailable.push(k);
      continue;
    }
    checkValue(k, v);
    total += v * weights[k];
  }
  const points = roundPoints(total);
  return unavailable.length ? { status: "partial", points, unavailable } : { status: "complete", points };
}

export function scoreOffense(stats: OffenseStats): ScoreResult {
  return applyWeights(stats, RULESET.offense, OFFENSE_REQUIRED, 0);
}

export function pointsAllowedTier(pointsAllowed: number): number {
  if (!Number.isInteger(pointsAllowed) || pointsAllowed < 0) {
    throw new RangeError(`points allowed must be a whole number >= 0, got ${pointsAllowed}`);
  }
  const tier = RULESET.pointsAllowedTiers.find((t) => t.max == null || pointsAllowed <= t.max);
  return tier!.points;
}

/** Points allowed is required: a missing opponent score is reported, never filled in. */
export function scoreDefense(stats: DefenseStats): ScoreResult {
  const { pointsAllowed, ...events } = stats;
  if (pointsAllowed == null) {
    return { status: "missing", missing: ["pointsAllowed", ...DEFENSE_REQUIRED.filter((k) => events[k] == null)] };
  }
  return applyWeights(events, RULESET.defense, DEFENSE_REQUIRED, pointsAllowedTier(pointsAllowed));
}

// Game points from scoring events, used to derive a team's score (and so its opponent's points
// allowed) in fixtures and to cross-check provider score columns.

export const GAME_EVENT_POINTS = {
  touchdown: 6,
  extra_point: 1,
  extra_point_missed: 0,
  two_point_conversion: 2,
  two_point_failed: 0,
  field_goal: 3,
  field_goal_missed: 0,
  /** Credited to the defending team, not the team tackled in its own end zone. */
  safety: 2,
  /** A returned PAT or two-point try, credited to the defending team. */
  defensive_two_point: 2,
} as const;

export type ScoringEventKind = keyof typeof GAME_EVENT_POINTS;

/** `team` is the team credited with the points. */
export type ScoringEvent = { id: string; team: string; kind: ScoringEventKind };

/** Sums points per team. A repeated event id counts once; a repeat with different content throws. */
export function gamePointsFromEvents(events: readonly ScoringEvent[]): Map<string, number> {
  const seen = new Map<string, ScoringEvent>();
  const totals = new Map<string, number>();
  for (const e of events) {
    const prev = seen.get(e.id);
    if (prev) {
      if (prev.team !== e.team || prev.kind !== e.kind) {
        throw new Error(`scoring event ${e.id} appears twice with different content`);
      }
      continue;
    }
    seen.set(e.id, e);
    totals.set(e.team, (totals.get(e.team) ?? 0) + GAME_EVENT_POINTS[e.kind]);
  }
  return totals;
}
