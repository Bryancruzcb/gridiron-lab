// Projection methods as pure functions of a history snapshot. A snapshot holds only rows strictly
// before the prediction cutoff (and schedule scores of earlier weeks), so position priors,
// opponent features and recency models all read the same pre-cutoff information.

import type { FantasyPos, StudyModelSpec, StudyUniversePlayer } from "../../../src/data/types.ts";
import type { DefenseRow, PlayerRow, PreparedSeason, ScheduledGame } from "./prepare.ts";
import { mean } from "./stats.ts";

export type Cutoff = { season: number; seasonType: "REG"; beforeWeek: number };

export function isBeforeCutoff(row: { season: number; week: number }, cutoff: Cutoff): boolean {
  return row.season < cutoff.season || (row.season === cutoff.season && row.week < cutoff.beforeWeek);
}

type GameKeyed = { season: number; week: number; gameId: string | null };

/** History order: season, week, then game id. */
export function compareByGame(a: GameKeyed, b: GameKeyed): number {
  const ga = a.gameId ?? "";
  const gb = b.gameId ?? "";
  return a.season - b.season || a.week - b.week || (ga < gb ? -1 : ga > gb ? 1 : 0);
}

export type ScoredPlayerRow = PlayerRow & { points: number };
export type ScoredDefenseRow = DefenseRow & { points: number };

export type HistorySnapshot = {
  cutoff: Cutoff;
  /** Scored rows before the cutoff by player id, in history order. Unscored rows are left out. */
  players: ReadonlyMap<string, readonly ScoredPlayerRow[]>;
  /** Scored defense rows before the cutoff by team, in history order. */
  defenses: ReadonlyMap<string, readonly ScoredDefenseRow[]>;
  /** Team on each player's latest row before the cutoff, scored or not. */
  latestTeam: ReadonlyMap<string, string>;
  /** Every game of the season; scores are kept only for weeks before the cutoff. */
  games: readonly ScheduledGame[];
  /** `${gameId}|${team}` to the scheduled opponent. */
  opponents: ReadonlyMap<string, string>;
};

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function snapshotBefore(data: PreparedSeason, cutoff: Cutoff): HistorySnapshot {
  if (cutoff.season !== data.season) {
    throw new RangeError(`cutoff season ${cutoff.season} does not match prepared season ${data.season}`);
  }
  const players = new Map<string, ScoredPlayerRow[]>();
  const latestTeam = new Map<string, string>();
  for (const r of data.players.filter((row) => isBeforeCutoff(row, cutoff)).sort(compareByGame)) {
    latestTeam.set(r.playerId, r.team);
    if (r.points != null) push(players, r.playerId, r as ScoredPlayerRow);
  }
  const defenses = new Map<string, ScoredDefenseRow[]>();
  for (const r of data.defenses.filter((row) => isBeforeCutoff(row, cutoff)).sort(compareByGame)) {
    if (r.points != null) push(defenses, r.team, r as ScoredDefenseRow);
  }
  const games = data.games.map((g) =>
    isBeforeCutoff(g, cutoff) ? g : { ...g, awayScore: null, homeScore: null, final: false },
  );
  const opponents = new Map<string, string>();
  for (const g of games) {
    opponents.set(`${g.gameId}|${g.away}`, g.home);
    opponents.set(`${g.gameId}|${g.home}`, g.away);
  }
  return { cutoff, players, defenses, latestTeam, games, opponents };
}

export type Features = {
  /** Mean points of the pool's players at the position before the cutoff; the fallback when none (or a mean of exactly 0). The shrink prior. */
  positionMean(pos: FantasyPos): number;
  /**
   * Mean points against the opponent by every pre-cutoff source row at the position (backups
   * included; defense rows for DST), or null when there are none.
   */
  opponentAllowed(pos: FantasyPos, opponent: string): number | null;
  /** The same rows as opponentAllowed pooled over every opponent, or null when there are none. */
  leagueAllowed(pos: FantasyPos): number | null;
};

type Cell = { total: number; n: number };

export function buildFeatures(
  snapshot: HistorySnapshot,
  pool: readonly StudyUniversePlayer[],
  positionPriorFallback: number,
): Features {
  const positionMeans = new Map<FantasyPos, number>();
  let allowed: Map<string, Cell> | null = null;

  const positionMean = (pos: FantasyPos) => {
    let v = positionMeans.get(pos);
    if (v == null) {
      const xs: number[] = [];
      for (const p of pool) {
        if (p.pos !== pos) continue;
        const rows = pos === "DST" ? snapshot.defenses.get(p.team) : snapshot.players.get(p.id);
        for (const r of rows ?? []) xs.push(r.points);
      }
      v = mean(xs) || positionPriorFallback;
      positionMeans.set(pos, v);
    }
    return v;
  };

  // Keys `${pos}|${opponent}` and `${pos}` (every opponent) over one population of rows.
  const allowedIndex = () => {
    if (allowed) return allowed;
    const index = new Map<string, Cell>();
    const add = (pos: string, opp: string, points: number) => {
      for (const key of [`${pos}|${opp}`, pos]) {
        const cell = index.get(key) ?? { total: 0, n: 0 };
        cell.total += points;
        cell.n += 1;
        index.set(key, cell);
      }
    };
    for (const rows of snapshot.players.values()) {
      for (const r of rows) {
        const opp = r.gameId ? snapshot.opponents.get(`${r.gameId}|${r.team}`) : undefined;
        if (opp && r.position) add(r.position, opp, r.points);
      }
    }
    for (const rows of snapshot.defenses.values()) {
      for (const r of rows) {
        const opp = r.gameId ? snapshot.opponents.get(`${r.gameId}|${r.team}`) : undefined;
        if (opp) add("DST", opp, r.points);
      }
    }
    allowed = index;
    return index;
  };
  const cellMean = (key: string) => {
    const cell = allowedIndex().get(key);
    return cell ? cell.total / cell.n : null;
  };

  return {
    positionMean,
    opponentAllowed: (pos, opponent) => cellMean(`${pos}|${opponent}`),
    leagueAllowed: (pos) => cellMean(pos),
  };
}

/**
 * opp@2: what the opponent allowed at the position over what every opponent allowed, both from the
 * same pre-cutoff rows, so the row-weighted mean factor across opponents is exactly 1. 1 without a
 * scheduled opponent, without rows on either side, or when the league mean is not positive.
 */
export function opponentFactor(features: Features, pos: FantasyPos, opponent: string | null): number {
  if (!opponent) return 1;
  const against = features.opponentAllowed(pos, opponent);
  const league = features.leagueAllowed(pos);
  return against == null || league == null || !(league > 0) ? 1 : against / league;
}

export type ProjectionSubject = {
  id: string;
  pos: FantasyPos;
  /** Latest team before the cutoff (DST: the universe team). */
  team: string;
  /** Scheduled opponent for the predicted week. */
  opponent: string | null;
};

export function ewma(xs: readonly number[], alpha: number): number {
  if (!xs.length) throw new RangeError("ewma of an empty history");
  let v = xs[0]!;
  for (let i = 1; i < xs.length; i++) v = alpha * xs[i]! + (1 - alpha) * v;
  return v;
}

function param(model: StudyModelSpec, name: string): number {
  const v = model.params[name];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new RangeError(`model ${model.id} is missing parameter ${name}`);
  return v;
}

export function historyGames(snapshot: HistorySnapshot, subject: Pick<ProjectionSubject, "id" | "pos" | "team">): number {
  return (subject.pos === "DST" ? snapshot.defenses.get(subject.team) : snapshot.players.get(subject.id))?.length ?? 0;
}

/** A finite projection from pre-cutoff history. Throws when the subject has no history. */
export function project(
  model: StudyModelSpec,
  subject: ProjectionSubject,
  snapshot: HistorySnapshot,
  features: Features,
): number {
  const playerRows = subject.pos === "DST" ? null : (snapshot.players.get(subject.id) ?? []);
  const rows = playerRows ?? snapshot.defenses.get(subject.team) ?? [];
  if (!rows.length) {
    throw new RangeError(`${subject.id} has no scored history before week ${snapshot.cutoff.beforeWeek}`);
  }
  const prior = rows.map((r) => r.points);
  const trail = mean(prior)!;
  switch (model.method) {
    case "trail":
      return trail;
    case "last1":
      return prior[prior.length - 1]!;
    case "last3":
      return mean(prior.slice(-param(model, "windowWeeks")))!;
    case "blend": {
      const w = param(model, "seasonWeight");
      return w * trail + (1 - w) * mean(prior.slice(-param(model, "windowWeeks")))!;
    }
    case "ewma":
      return ewma(prior, param(model, "alpha"));
    case "shrink": {
      const n = prior.length;
      const k = param(model, "k");
      return (n / (n + k)) * trail + (k / (n + k)) * features.positionMean(subject.pos);
    }
    case "usage": {
      if (!playerRows) return trail;
      const volume = playerRows.map((r) =>
        subject.pos === "QB" ? Math.max(r.attempts ?? 0, 1) : Math.max((r.carries ?? 0) + (r.targets ?? 0), 1),
      );
      const rate = playerRows.map((r, i) => r.points / volume[i]!);
      return mean(volume.slice(-param(model, "windowWeeks")))! * mean(rate)!;
    }
    case "opp": {
      const factor = opponentFactor(features, subject.pos, subject.opponent);
      return trail * Math.min(param(model, "clampHigh"), Math.max(param(model, "clampLow"), factor));
    }
  }
}
