import type { BoxPlayer, CallSplit, GameDetail, LiveGame, ScoringPlay } from "./types";
import { lookupPos, seedPosMap, type SkillPos } from "./names";
import {
  nflAbbr,
  parsePlayerLines,
  parseTeamBoxes,
  scoreEspnLine,
  stageOf,
  type EspnPlayerLine,
} from "../football/espn";
import { scoreMeta } from "../football/scoring";

export { nflAbbr, parseScoreboard } from "../football/espn";

const SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=";

const UA = { "User-Agent": "GridironLab/1.0 (analytics portfolio)" };

const BOARD_TTL = 12_000;
const SUM_TTL = 12_000;
let boardCache: { at: number; data: Record<string, unknown> } | null = null;
const summaryCache = new Map<string, { at: number; data: Record<string, unknown> }>();

async function espnJson(url: string) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return res.json();
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

// Known slate position wins; otherwise the first offensive block the player appears in.
function playerPos(line: EspnPlayerLine, posMap: Map<string, SkillPos>): BoxPlayer["pos"] {
  const known = lookupPos(posMap, line.name, line.team);
  if (known) return known;
  if (line.passed) return "QB";
  if (line.rushed) return "RB";
  if (line.caught) return "WR";
  return "FLEX";
}

function boxPlayer(line: EspnPlayerLine, posMap: Map<string, SkillPos>): BoxPlayer {
  const score = scoreEspnLine(line);
  return {
    id: line.id,
    name: line.name,
    team: line.team,
    headshot: line.headshot,
    pos: playerPos(line, posMap),
    passCmp: line.passCmp,
    passAtt: line.passAtt,
    passYds: line.passYds,
    passTd: line.passTd,
    ints: line.ints,
    rushAtt: line.rushAtt,
    rushYds: line.rushYds,
    rushTd: line.rushTd,
    rec: line.rec,
    recYds: line.recYds,
    recTd: line.recTd,
    ppr: score.points,
    score: scoreMeta(score),
  };
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
  const teamBox = parseTeamBoxes(raw);
  const players = parsePlayerLines(raw).map((line) => boxPlayer(line, posMap));

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

  const ranked = [...players].sort((a, b) => b.ppr - a.ppr);

  return {
    game: { ...boardGame, stage: stageOf(boardGame.status, Boolean(advanced)) },
    teamBox,
    players: ranked,
    scoring,
    calling,
    advanced,
  };
}

export async function fetchScoreboardRaw() {
  if (boardCache && Date.now() - boardCache.at < BOARD_TTL) return boardCache.data;
  const data = (await espnJson(SCOREBOARD)) as Record<string, unknown>;
  boardCache = { at: Date.now(), data };
  return data;
}

export async function fetchSummaryRaw(eventId: string) {
  if (!/^\d{6,12}$/.test(eventId)) throw new Error("Bad event id");
  const hit = summaryCache.get(eventId);
  if (hit && Date.now() - hit.at < SUM_TTL) return hit.data;
  const data = (await espnJson(`${SUMMARY}${eventId}`)) as Record<string, unknown>;
  summaryCache.set(eventId, { at: Date.now(), data });
  return data;
}
