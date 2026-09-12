import { fetchScoreboardRaw, fetchSummaryRaw, parseScoreboard, parseSummary } from "./espn.server";
import { positionMap, weekPlayers } from "./season.server";
import { nameTeamKey } from "./names";
import type { TeamSide, WeekPpr, WeekSkill } from "./types";
import { espnDefenseStats, twoPointScoresFromPlays } from "../football/espn";
import { isScored, scoreDefense, scoreMeta } from "../football/scoring";
import { mergeCurrentWeek } from "../football/week-merge";

const TTL_MS = 2 * 60 * 1000;
let cache: { at: number; data: WeekPpr } | null = null;
let inflight: Promise<WeekPpr> | null = null;

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, Math.max(items.length, 1)) }, () => worker()));
  return out;
}

async function build(): Promise<WeekPpr> {
  const [raw, pos, week] = await Promise.all([
    fetchScoreboardRaw(),
    positionMap().catch(() => null),
    weekPlayers().catch(() => null),
  ]);
  const board = parseScoreboard(raw, new Set());
  const active = board.games.filter((g) => g.status === "in" || g.status === "post");
  const posMap = pos ?? (await import("./names")).seedPosMap();

  const details = await pool(active, 5, async (g) => {
    try {
      const summary = await fetchSummaryRaw(g.id);
      return {
        detail: parseSummary(summary, g, null, posMap),
        twoPointScores: twoPointScoresFromPlays(summary, g.away.abbr, g.home.abbr),
      };
    } catch {
      return null;
    }
  });

  const live: WeekSkill[] = [];
  for (const d of details) {
    if (!d) continue;
    const { game, players, teamBox } = d.detail;
    for (const p of players) {
      live.push({
        gsisId: null,
        espnId: p.id,
        name: p.name,
        team: p.team,
        pos: p.pos === "FLEX" ? "WR" : p.pos,
        ppr: p.ppr,
        headshot: p.headshot,
        status: game.status,
        source: "espn",
        score: p.score,
        passCmp: p.passCmp,
        passAtt: p.passAtt,
        passYds: p.passYds,
        passTd: p.passTd,
        ints: p.ints,
        rushAtt: p.rushAtt,
        rushYds: p.rushYds,
        rushTd: p.rushTd,
        rec: p.rec,
        recYds: p.recYds,
        recTd: p.recTd,
      });
    }
    const sides: [TeamSide, TeamSide][] = [
      [game.away, game.home],
      [game.home, game.away],
    ];
    for (const [team, opponent] of sides) {
      const score = scoreDefense(
        espnDefenseStats({
          team: team.abbr,
          opponent: opponent.abbr,
          boxes: teamBox,
          opponentScore: opponent.score,
          twoPointScores: d.twoPointScores,
        }),
      );
      // No D/ST row without its required inputs; a filled-in score would look real.
      if (!isScored(score)) continue;
      live.push({
        gsisId: null,
        espnId: `DST-${team.abbr}`,
        name: `${team.abbr} D/ST`,
        team: team.abbr,
        pos: "DST",
        ppr: score.points,
        headshot: null,
        status: game.status,
        source: "espn",
        score: scoreMeta(score),
      });
    }
  }

  return {
    season: board.season,
    seasonType: board.seasonType,
    week: board.week,
    fetchedAt: new Date().toISOString(),
    gamesFinal: board.games.filter((g) => g.status === "post").length,
    gamesLive: board.games.filter((g) => g.status === "in").length,
    games: board.games.length,
    players: mergeCurrentWeek({
      week: board.weekKey,
      live,
      published: week?.weeks ?? [],
      identity: nameTeamKey,
    }),
  };
}

export async function loadWeekPpr(): Promise<WeekPpr> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (inflight) return inflight;
  inflight = build()
    .then((data) => {
      cache = { at: Date.now(), data };
      return data;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
