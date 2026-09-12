// Pure parsing of ESPN's public site API. Fetching and caching stay in live/espn.server.ts.

import type { GameStage, GameStatus, LiveGame, Scoreboard, TeamBox, TeamSide } from "../live/types.ts";
import type { SeasonType, WeekKey } from "./player-weeks.ts";
import { isScored, scoreOffense, type DefenseStats, type OffenseStats, type Scored } from "./scoring.ts";

type Json = Record<string, unknown>;

const ESPN_TO_NFL: Record<string, string> = { LAR: "LA", WSH: "WAS" };

export function nflAbbr(espn: string) {
  return ESPN_TO_NFL[espn] ?? espn;
}

/** ESPN season.type: 1 preseason, 2 regular season, 3 postseason. Anything else has no join key. */
export function espnSeasonType(v: unknown): SeasonType | null {
  const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN;
  if (n === 1) return "PRE";
  if (n === 2) return "REG";
  if (n === 3) return "POST";
  return null;
}

// Display values keep the old lenient parse; values that feed scoring go through count().
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function finiteOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function side(c: Json): TeamSide {
  const team = (c.team ?? {}) as Json;
  const espnAbbr = String(team.abbreviation ?? "");
  const recs = (c.records as { summary?: string }[] | undefined) ?? [];
  return {
    abbr: nflAbbr(espnAbbr),
    espnAbbr,
    name: String(team.displayName ?? espnAbbr),
    nick: String(team.shortDisplayName ?? team.name ?? espnAbbr),
    score: num(c.score),
    record: recs[0]?.summary ?? null,
    logo: typeof team.logo === "string" ? team.logo : null,
    winner: Boolean(c.winner),
  };
}

export function stageOf(status: GameStatus, hasAdvanced: boolean): GameStage {
  if (status === "pre") return "pregame";
  if (status === "in") return "live";
  if (hasAdvanced) return "advanced";
  return "final";
}

export function parseScoreboard(raw: Json, advancedKeys: Set<string>): Scoreboard {
  const seasonRaw = (raw.season as Json | undefined) ?? {};
  const year = finiteOrNull(seasonRaw.year);
  const weekNumber = finiteOrNull((raw.week as Json | undefined)?.number);
  const seasonType = espnSeasonType(seasonRaw.type);
  const weekKey: WeekKey | null =
    year != null && weekNumber != null && seasonType ? { season: year, seasonType, week: weekNumber } : null;
  // Display fallbacks only: weekKey stays null, so nothing is joined on a guessed week.
  const season = year ?? 2026;
  const week = weekNumber ?? 1;
  const events = (raw.events as Json[]) ?? [];
  const games: LiveGame[] = [];

  for (const ev of events) {
    const comps = (ev.competitions as Json[]) ?? [];
    const comp = comps[0];
    if (!comp) continue;
    const competitors = (comp.competitors as Json[]) ?? [];
    const homeRaw = competitors.find((c) => c.homeAway === "home");
    const awayRaw = competitors.find((c) => c.homeAway === "away");
    if (!homeRaw || !awayRaw) continue;
    const home = side(homeRaw);
    const away = side(awayRaw);
    const st = (comp.status as { type?: Json; displayClock?: string; period?: number }) ?? {};
    const type = st.type ?? {};
    const state = String(type.state ?? "pre") as GameStatus;
    const status: GameStatus = state === "in" || state === "post" ? state : "pre";
    const sit = (comp.situation as Json | undefined) ?? undefined;
    const lastPlayObj = sit?.lastPlay as { text?: string } | undefined;
    const broadcasts = (comp.broadcasts as { names?: string[] }[] | undefined) ?? [];
    const venue = (comp.venue as { fullName?: string } | undefined)?.fullName ?? null;
    const nflverseKey = `${season}_${String(week).padStart(2, "0")}_${away.abbr}_${home.abbr}`;
    const hasAdv = advancedKeys.has(nflverseKey);
    games.push({
      id: String(ev.id ?? ""),
      start: String(ev.date ?? ""),
      status,
      statusText: String(type.shortDetail ?? type.description ?? status),
      clock: status === "in" ? (st.displayClock as string | undefined) ?? null : null,
      period: status === "in" ? (typeof st.period === "number" ? st.period : null) : null,
      week,
      season,
      seasonType,
      broadcast: broadcasts[0]?.names?.[0] ?? null,
      venue,
      lastPlay: lastPlayObj?.text ?? null,
      situation: typeof sit?.downDistanceText === "string" ? String(sit.downDistanceText) : null,
      away,
      home,
      stage: stageOf(status, hasAdv),
      nflverseKey,
    });
  }

  return {
    season,
    week,
    seasonType,
    weekKey,
    fetchedAt: new Date().toISOString(),
    anyLive: games.some((g) => g.status === "in"),
    games,
  };
}

function statMap(stats: unknown) {
  const m = new Map<string, string>();
  for (const s of (Array.isArray(stats) ? stats : []) as { name?: string; displayValue?: string; value?: unknown }[]) {
    if (s.name) m.set(s.name, String(s.displayValue ?? s.value ?? ""));
  }
  return m;
}

function count(v: string | undefined): number | null {
  return finiteOrNull(v);
}

/** "4-14" (sacks-yards lost) to 4. */
function leadingCount(v: string | undefined): number | null {
  const m = v?.match(/^(\d+)\s*-/);
  return m ? Number(m[1]) : null;
}

/**
 * Team box orientation, checked on 2025 week 5 against nflverse team-week (28 of 28 team boxes):
 * interceptions, fumblesLost, sacksYardsLost and turnovers are what the team gave up.
 * defensiveTouchdowns is what the team scored on defense and returns (166 of 170 team-games).
 */
export function parseTeamBoxes(raw: Json): TeamBox[] {
  const box = (raw.boxscore as Json | undefined) ?? {};
  const rows = (box.teams as Json[] | undefined) ?? [];
  return rows.map((row) => {
    const m = statMap(row.statistics);
    return {
      abbr: nflAbbr(String((row.team as { abbreviation?: string } | undefined)?.abbreviation ?? "")),
      plays: count(m.get("totalOffensivePlays")),
      yards: count(m.get("totalYards")),
      passYds: count(m.get("netPassingYards")),
      rushYds: count(m.get("rushingYards")),
      compAtt: m.get("completionAttempts") ?? null,
      thirdDown: m.get("thirdDownEff") ?? null,
      fourthDown: m.get("fourthDownEff") ?? null,
      possession: m.get("possessionTime") ?? null,
      giveaways: count(m.get("turnovers")),
      interceptionsThrown: count(m.get("interceptions")),
      fumblesLost: count(m.get("fumblesLost")),
      sacksSuffered: leadingCount(m.get("sacksYardsLost")),
      defenseTds: count(m.get("defensiveTouchdowns")),
    };
  });
}

export type EspnPlayerLine = {
  id: string;
  name: string;
  team: string;
  headshot: string | null;
  passed: boolean;
  rushed: boolean;
  caught: boolean;
  passCmp: number | null;
  passAtt: number | null;
  passYds: number;
  passTd: number;
  ints: number;
  rushAtt: number;
  rushYds: number;
  rushTd: number;
  rec: number;
  recYds: number;
  recTd: number;
  /** ESPN fumbles block: every fumble the player lost, returns included. */
  fumblesLost: number;
  /** Kick and punt return touchdowns. */
  returnTds: number;
};

const COLUMNS = {
  passing: ["completions/passingAttempts", "passingYards", "passingTouchdowns", "interceptions"],
  rushing: ["rushingAttempts", "rushingYards", "rushingTouchdowns"],
  receiving: ["receptions", "receivingYards", "receivingTouchdowns"],
  fumbles: ["fumblesLost"],
  kickReturns: ["kickReturnTouchdowns"],
  puntReturns: ["puntReturnTouchdowns"],
} as const;

type BlockName = keyof typeof COLUMNS;
const PRIMARY = new Set<string>(["passing", "rushing", "receiving"]);

/** Looks up stat positions by ESPN's column keys; a renamed column throws instead of reading zeros. */
function columnReader<B extends BlockName>(block: Json, name: B) {
  const keys = block.keys;
  if (!Array.isArray(keys)) throw new Error(`ESPN ${name} block has no keys`);
  const at = new Map<string, number>();
  for (const k of COLUMNS[name]) {
    const i = keys.indexOf(k);
    if (i < 0) throw new Error(`ESPN ${name} block has no ${k} column`);
    at.set(k, i);
  }
  return (stats: string[], key: (typeof COLUMNS)[B][number]) => stats[at.get(key)!];
}

function parseFrac(v: string | undefined): [number, number] | null {
  const m = v?.match(/^(\d+)\s*\/\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Offensive blocks create lines; fumble and return blocks only add to players already listed. */
export function parsePlayerLines(raw: Json): EspnPlayerLine[] {
  const box = (raw.boxscore as Json | undefined) ?? {};
  const groups = (box.players as Json[] | undefined) ?? [];
  const lines = new Map<string, EspnPlayerLine>();
  for (const primaryPass of [true, false]) {
    for (const g of groups) {
      const team = nflAbbr(String((g.team as { abbreviation?: string } | undefined)?.abbreviation ?? ""));
      for (const block of (g.statistics as Json[] | undefined) ?? []) {
        const name = String(block.name ?? "");
        if (!(name in COLUMNS) || PRIMARY.has(name) !== primaryPass) continue;
        for (const ath of (block.athletes as Json[] | undefined) ?? []) {
          const a = (ath.athlete ?? ath) as Json;
          const id = String(a.id ?? a.displayName ?? "");
          const stats = ((ath.stats as unknown[] | undefined) ?? []).map(String);
          let line = lines.get(id);
          if (!line) {
            if (!primaryPass) continue;
            line = {
              id,
              name: String(a.displayName ?? "Unknown"),
              team,
              headshot: (a.headshot as { href?: string } | undefined)?.href ?? null,
              passed: false,
              rushed: false,
              caught: false,
              passCmp: null,
              passAtt: null,
              passYds: 0,
              passTd: 0,
              ints: 0,
              rushAtt: 0,
              rushYds: 0,
              rushTd: 0,
              rec: 0,
              recYds: 0,
              recTd: 0,
              fumblesLost: 0,
              returnTds: 0,
            };
            lines.set(id, line);
          }
          applyBlock(line, block, name as BlockName, stats);
        }
      }
    }
  }
  return [...lines.values()];
}

function applyBlock(line: EspnPlayerLine, block: Json, name: BlockName, stats: string[]) {
  switch (name) {
    case "passing": {
      const get = columnReader(block, name);
      const ca = parseFrac(get(stats, "completions/passingAttempts"));
      line.passCmp = ca?.[0] ?? line.passCmp;
      line.passAtt = ca?.[1] ?? line.passAtt;
      line.passYds = num(get(stats, "passingYards"));
      line.passTd = num(get(stats, "passingTouchdowns"));
      line.ints = num(get(stats, "interceptions"));
      line.passed = true;
      return;
    }
    case "rushing": {
      const get = columnReader(block, name);
      line.rushAtt += num(get(stats, "rushingAttempts"));
      line.rushYds += num(get(stats, "rushingYards"));
      line.rushTd += num(get(stats, "rushingTouchdowns"));
      line.rushed = true;
      return;
    }
    case "receiving": {
      const get = columnReader(block, name);
      line.rec += num(get(stats, "receptions"));
      line.recYds += num(get(stats, "receivingYards"));
      line.recTd += num(get(stats, "receivingTouchdowns"));
      line.caught = true;
      return;
    }
    case "fumbles":
      line.fumblesLost += num(columnReader(block, name)(stats, "fumblesLost"));
      return;
    case "kickReturns":
      line.returnTds += num(columnReader(block, name)(stats, "kickReturnTouchdowns"));
      return;
    case "puntReturns":
      line.returnTds += num(columnReader(block, name)(stats, "puntReturnTouchdowns"));
      return;
  }
}

/** ESPN's box score has no per-player two-point conversions, so that input stays unavailable. */
export function espnOffenseStats(line: EspnPlayerLine): OffenseStats {
  return {
    passingYards: line.passYds,
    passingTds: line.passTd,
    interceptions: line.ints,
    rushingYards: line.rushYds,
    rushingTds: line.rushTd,
    receptions: line.rec,
    receivingYards: line.recYds,
    receivingTds: line.recTd,
    fumblesLost: line.fumblesLost,
    twoPointConversions: null,
    specialTeamsTds: line.returnTds,
  };
}

export function scoreEspnLine(line: EspnPlayerLine): Scored {
  const s = scoreOffense(espnOffenseStats(line));
  if (!isScored(s)) throw new Error(`ESPN line ${line.id} lacks ${s.missing.join(", ")}`);
  return s;
}

/**
 * Safeties and returned PAT/two-point tries per team, from the running score on each scoring play.
 * Offensive scores add 3, 6, 7 or 8 (a conversion is listed with its touchdown), so a +2 step is a
 * defensive two-point score. Matched nflverse def_safeties + def_2pt_made on 170 of 170 2025 team-games.
 * null when the summary has no scoring play list or a play lacks a score.
 */
export function twoPointScoresFromPlays(raw: Json, away: string, home: string): Map<string, number> | null {
  const plays = raw.scoringPlays;
  if (!Array.isArray(plays)) return null;
  const out = new Map<string, number>([
    [away, 0],
    [home, 0],
  ]);
  let awayScore = 0;
  let homeScore = 0;
  for (const p of plays as Json[]) {
    const a = finiteOrNull(p.awayScore);
    const h = finiteOrNull(p.homeScore);
    if (a == null || h == null) return null;
    if (a - awayScore === 2) out.set(away, out.get(away)! + 1);
    if (h - homeScore === 2) out.set(home, out.get(home)! + 1);
    awayScore = a;
    homeScore = h;
  }
  return out;
}

/** A team's defense in one ESPN game: takeaways are read from the opponent's box. */
export function espnDefenseStats(args: {
  team: string;
  opponent: string;
  boxes: readonly TeamBox[];
  opponentScore: number | null;
  twoPointScores: ReadonlyMap<string, number> | null;
}): DefenseStats {
  const own = args.boxes.find((b) => b.abbr === args.team);
  const opp = args.boxes.find((b) => b.abbr === args.opponent);
  return {
    sacks: opp?.sacksSuffered ?? null,
    interceptions: opp?.interceptionsThrown ?? null,
    fumbleRecoveries: opp?.fumblesLost ?? null,
    touchdowns: own?.defenseTds ?? null,
    twoPointScores: args.twoPointScores?.get(args.team) ?? null,
    blockedKicks: null,
    pointsAllowed: args.opponentScore,
  };
}
