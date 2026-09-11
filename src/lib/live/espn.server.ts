import type {
  BoxPlayer,
  CallSplit,
  GameDetail,
  GameStage,
  GameStatus,
  LiveGame,
  Scoreboard,
  ScoringPlay,
  TeamBox,
  TeamSide,
} from "./types";
import { lookupPos, seedPosMap, type SkillPos } from "./names";

const SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=";

const ESPN_TO_NFL: Record<string, string> = { LAR: "LA", WSH: "WAS" };

export function nflAbbr(espn: string) {
  return ESPN_TO_NFL[espn] ?? espn;
}

const UA = { "User-Agent": "GridironLab/1.0 (analytics portfolio)" };

async function espnJson(url: string) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return res.json();
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function side(c: Record<string, unknown>): TeamSide {
  const team = (c.team ?? {}) as Record<string, unknown>;
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

function stageOf(status: GameStatus, hasAdvanced: boolean): GameStage {
  if (status === "pre") return "pregame";
  if (status === "in") return "live";
  if (hasAdvanced) return "advanced";
  return "final";
}

export function parseScoreboard(raw: Record<string, unknown>, advancedKeys: Set<string>): Scoreboard {
  const season = Number((raw.season as { year?: number } | undefined)?.year ?? 2026);
  const week = Number((raw.week as { number?: number } | undefined)?.number ?? 1);
  const events = (raw.events as Record<string, unknown>[]) ?? [];
  const games: LiveGame[] = [];

  for (const ev of events) {
    const comps = (ev.competitions as Record<string, unknown>[]) ?? [];
    const comp = comps[0];
    if (!comp) continue;
    const competitors = (comp.competitors as Record<string, unknown>[]) ?? [];
    const homeRaw = competitors.find((c) => c.homeAway === "home");
    const awayRaw = competitors.find((c) => c.homeAway === "away");
    if (!homeRaw || !awayRaw) continue;
    const home = side(homeRaw);
    const away = side(awayRaw);
    const st = (comp.status as { type?: Record<string, unknown>; displayClock?: string; period?: number }) ?? {};
    const type = st.type ?? {};
    const state = String(type.state ?? "pre") as GameStatus;
    const status: GameStatus = state === "in" || state === "post" ? state : "pre";
    const sit = (comp.situation as Record<string, unknown> | undefined) ?? undefined;
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
    fetchedAt: new Date().toISOString(),
    anyLive: games.some((g) => g.status === "in"),
    games,
  };
}

function statMap(stats: { name?: string; displayValue?: string; value?: unknown }[] | undefined) {
  const m = new Map<string, string>();
  for (const s of stats ?? []) {
    if (s.name) m.set(s.name, String(s.displayValue ?? s.value ?? ""));
  }
  return m;
}

function parseFrac(v: string | null | undefined): [number, number] | null {
  if (!v) return null;
  const m = v.match(/^(\d+)\s*\/\s*(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

function parseSacks(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.match(/^(\d+)/);
  return m ? Number(m[1]) : null;
}

function ppr(p: {
  passYds: number;
  passTd: number;
  ints: number;
  rushYds: number;
  rushTd: number;
  rec: number;
  recYds: number;
  recTd: number;
}) {
  return (
    p.passYds / 25 +
    p.passTd * 4 -
    p.ints * 2 +
    p.rushYds / 10 +
    p.rushTd * 6 +
    p.rec +
    p.recYds / 10 +
    p.recTd * 6
  );
}

function mergePlayer(
  map: Map<string, BoxPlayer>,
  team: string,
  athlete: Record<string, unknown>,
  stats: string[],
  kind: "passing" | "rushing" | "receiving",
  posMap: Map<string, SkillPos>,
) {
  const a = (athlete.athlete ?? athlete) as Record<string, unknown>;
  const id = String(a.id ?? a.displayName ?? "");
  const name = String(a.displayName ?? "Unknown");
  const head = (a.headshot as { href?: string } | undefined)?.href ?? null;
  const known = lookupPos(posMap, name, team);
  const prev =
    map.get(id) ??
    ({
      id,
      name,
      team,
      headshot: head,
      pos: known ?? "FLEX",
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
      ppr: 0,
    } satisfies BoxPlayer);

  if (kind === "passing") {
    const ca = parseFrac(stats[0]);
    prev.passCmp = ca?.[0] ?? prev.passCmp;
    prev.passAtt = ca?.[1] ?? prev.passAtt;
    prev.passYds = num(stats[1]);
    prev.passTd = num(stats[3]);
    prev.ints = num(stats[4]);
    prev.pos = known ?? "QB";
  } else if (kind === "rushing") {
    prev.rushAtt += num(stats[0]);
    prev.rushYds += num(stats[1]);
    prev.rushTd += num(stats[3]);
    if (prev.pos === "FLEX") prev.pos = known ?? "RB";
  } else {
    prev.rec += num(stats[0]);
    prev.recYds += num(stats[1]);
    prev.recTd += num(stats[3]);
    if (known) prev.pos = known;
    else if (prev.pos === "FLEX") prev.pos = "WR";
  }
  prev.headshot = prev.headshot ?? head;
  prev.ppr = Math.round(ppr(prev) * 10) / 10;
  map.set(id, prev);
}

const SKIP_PLAY = /timeout|two-minute|kickoff|extra point|two-point|official timeout|end of|coin toss/i;
const PUNT = /punt/i;
const FG = /field goal/i;
const PASS = /pass|sack|interception|incomplete/i;
const RUSH = /rush|scramble|kneel/i;

function classifyPlay(typeText: string, text: string): "pass" | "rush" | "punt" | "fg" | "skip" {
  const blob = `${typeText} ${text}`;
  if (SKIP_PLAY.test(typeText) && !PASS.test(blob) && !RUSH.test(blob)) return "skip";
  if (PUNT.test(blob) && !PASS.test(typeText) && !RUSH.test(typeText)) return "punt";
  if (FG.test(blob) && !PASS.test(typeText) && !RUSH.test(typeText)) return "fg";
  if (PASS.test(blob)) return "pass";
  if (RUSH.test(blob)) return "rush";
  if (SKIP_PLAY.test(blob)) return "skip";
  return "skip";
}

export function parseSummary(
  raw: Record<string, unknown>,
  boardGame: LiveGame,
  advanced: GameDetail["advanced"],
  posMap: Map<string, SkillPos> = seedPosMap(),
): GameDetail {
  const box = (raw.boxscore as Record<string, unknown> | undefined) ?? {};
  const teamRows = (box.teams as Record<string, unknown>[]) ?? [];
  const teamBox: TeamBox[] = teamRows.map((row) => {
    const abbr = nflAbbr(String((row.team as { abbreviation?: string } | undefined)?.abbreviation ?? ""));
    const m = statMap(row.statistics as { name?: string; displayValue?: string }[]);
    return {
      abbr,
      plays: m.has("totalOffensivePlays") ? num(m.get("totalOffensivePlays")) : null,
      yards: m.has("totalYards") ? num(m.get("totalYards")) : null,
      passYds: m.has("netPassingYards") ? num(m.get("netPassingYards")) : null,
      rushYds: m.has("rushingYards") ? num(m.get("rushingYards")) : null,
      compAtt: m.get("completionAttempts") ?? null,
      thirdDown: m.get("thirdDownEff") ?? null,
      fourthDown: m.get("fourthDownEff") ?? null,
      turnovers: m.has("turnovers") ? num(m.get("turnovers")) : null,
      possession: m.get("possessionTime") ?? null,
      sacks: parseSacks(m.get("sacksYardsLost")),
      defTd: m.has("defensiveTouchdowns") ? num(m.get("defensiveTouchdowns")) : null,
      ints: m.has("interceptions") ? num(m.get("interceptions")) : null,
    };
  });

  const players = new Map<string, BoxPlayer>();
  const groups = (box.players as Record<string, unknown>[]) ?? [];
  for (const g of groups) {
    const team = nflAbbr(String((g.team as { abbreviation?: string } | undefined)?.abbreviation ?? ""));
    const stats = (g.statistics as Record<string, unknown>[]) ?? [];
    for (const block of stats) {
      const kind = String(block.name ?? "");
      if (kind !== "passing" && kind !== "rushing" && kind !== "receiving") continue;
      const athletes = (block.athletes as Record<string, unknown>[]) ?? [];
      for (const ath of athletes) {
        mergePlayer(players, team, ath, ((ath.stats as string[]) ?? []).map(String), kind, posMap);
      }
    }
  }

  const scoring: ScoringPlay[] = ((raw.scoringPlays as Record<string, unknown>[]) ?? []).map((p) => ({
    q: num((p.period as { number?: number } | undefined)?.number),
    clock: String((p.clock as { displayValue?: string } | undefined)?.displayValue ?? ""),
    team: nflAbbr(String((p.team as { abbreviation?: string } | undefined)?.abbreviation ?? "")),
    text: String(p.text ?? ""),
    away: num(p.awayScore),
    home: num(p.homeScore),
  }));

  const callingAcc = new Map<
    string,
    { plays: number; pass: number; rush: number; ssPass: number; ssN: number; fourthGo: number; fourthOpp: number }
  >();
  const bump = (team: string) => {
    const cur = callingAcc.get(team) ?? {
      plays: 0,
      pass: 0,
      rush: 0,
      ssPass: 0,
      ssN: 0,
      fourthGo: 0,
      fourthOpp: 0,
    };
    callingAcc.set(team, cur);
    return cur;
  };

  const drives = (raw.drives as { previous?: Record<string, unknown>[] } | undefined)?.previous ?? [];
  for (const dr of drives) {
    const team = nflAbbr(String((dr.team as { abbreviation?: string } | undefined)?.abbreviation ?? ""));
    if (!team) continue;
    const plays = (dr.plays as Record<string, unknown>[]) ?? [];
    for (const pl of plays) {
      const start = (pl.start as { down?: number; distance?: number } | undefined) ?? {};
      const typeText = String((pl.type as { text?: string } | undefined)?.text ?? "");
      const text = String(pl.text ?? "");
      const kind = classifyPlay(typeText, text);
      if (kind === "skip") continue;
      const acc = bump(team);
      const down = Number(start.down ?? 0);
      const dist = Number(start.distance ?? 0);
      if (kind === "pass" || kind === "rush") {
        acc.plays += 1;
        if (kind === "pass") acc.pass += 1;
        else acc.rush += 1;
        if (down === 2 && dist <= 3) {
          acc.ssN += 1;
          if (kind === "pass") acc.ssPass += 1;
        }
      }
      if (down === 4) {
        if (kind === "punt" || kind === "fg") {
          acc.fourthOpp += 1;
        } else if (kind === "pass" || kind === "rush") {
          acc.fourthOpp += 1;
          acc.fourthGo += 1;
        }
      }
    }
  }

  const calling: CallSplit[] = [...callingAcc.entries()].map(([team, a]) => ({
    team,
    plays: a.plays,
    passRate: a.plays ? a.pass / a.plays : null,
    secondAndShortPass: a.ssN ? a.ssPass / a.ssN : null,
    secondAndShortN: a.ssN,
    fourthGoRate: a.fourthOpp ? a.fourthGo / a.fourthOpp : null,
    fourthOpps: a.fourthOpp,
  }));

  const ranked = [...players.values()].sort((a, b) => b.ppr - a.ppr);

  return {
    game: { ...boardGame, stage: stageOf(boardGame.status, Boolean(advanced)) },
    teamBox,
    players: ranked,
    scoring,
    calling,
    advanced,
  };
}

export function dstPpr(opts: { pa: number; sacks: number; ints: number; turnovers: number; defTd: number }) {
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

export async function fetchScoreboardRaw() {
  return espnJson(SCOREBOARD) as Promise<Record<string, unknown>>;
}

export async function fetchSummaryRaw(eventId: string) {
  if (!/^\d{6,12}$/.test(eventId)) throw new Error("Bad event id");
  return espnJson(`${SUMMARY}${eventId}`) as Promise<Record<string, unknown>>;
}
