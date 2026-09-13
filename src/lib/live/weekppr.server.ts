import { loadScoreboardRaw, loadSummaryRaw, parseScoreboard, parseSummary } from "./espn.server";
import { loadWeekPlayers } from "./season.server";
import { nameTeamKey, seedPosMap } from "./names";
import type { FeedResponse, LiveGame, TeamSide, WeekPpr, WeekSkill } from "./types";
import { FEED_POLICY } from "./feed-state";
import { createLoader, toFeedResponse, UpstreamError } from "./loader";
import { espnDefenseStats, twoPointScoresFromPlays } from "../football/espn";
import { isScored, scoreDefense, scoreMeta } from "../football/scoring";
import { mergeCurrentWeek } from "../football/week-merge";

type WeekBuild = { ppr: WeekPpr; partial: string[] };

// The published file only upgrades finals; live lines never wait long on it.
const PUBLISHED_WAIT_MS = 8_000;

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

const matchup = (g: LiveGame) => `${g.away.abbr}@${g.home.abbr}`;

async function build(): Promise<WeekBuild> {
  const [board, week] = await Promise.all([loadScoreboardRaw(), loadWeekPlayers(PUBLISHED_WAIT_MS)]);
  // Scoring the week from an out-of-date board would misstate which games are final.
  if (!board.ok) {
    throw new UpstreamError(board.error.code, board.error.message, {
      retryable: board.error.retryable,
      retryAfterMs: board.error.retryAfterMs,
    });
  }
  const parsed = parseScoreboard(board.data, new Set());
  const active = parsed.games.filter((g) => g.status === "in" || g.status === "post");
  const published = week.ok ? week.data : (week.stale?.data ?? null);
  const posMap = published?.pos ?? seedPosMap();
  const partial: string[] = [];

  const details = await pool(active, 5, async (g) => {
    const r = await loadSummaryRaw(g.id);
    const raw = r.ok ? r.data : r.stale?.data;
    if (!raw) {
      partial.push(`box score for ${matchup(g)}`);
      return null;
    }
    if (!r.ok) partial.push(`latest box score for ${matchup(g)} (showing an earlier fetch)`);
    try {
      return {
        detail: parseSummary(raw, g, null, posMap),
        twoPointScores: twoPointScoresFromPlays(raw, g.away.abbr, g.home.abbr),
      };
    } catch {
      partial.push(`box score for ${matchup(g)} (unreadable)`);
      return null;
    }
  });
  if (!published && active.some((g) => g.status === "post")) {
    partial.push("published nflverse stats (finals show ESPN box scores)");
  }

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
    partial: partial.sort(),
    ppr: {
      season: parsed.season,
      seasonType: parsed.seasonType,
      week: parsed.week,
      fetchedAt: new Date().toISOString(),
      gamesFinal: parsed.games.filter((g) => g.status === "post").length,
      gamesLive: parsed.games.filter((g) => g.status === "in").length,
      games: parsed.games.length,
      players: mergeCurrentWeek({
        week: parsed.weekKey,
        live,
        published: published?.weeks ?? [],
        identity: nameTeamKey,
      }),
    },
  };
}

// The ESPN loaders underneath own their own retries and bounds; this layer only caches the merge.
const loader = createLoader<WeekBuild>({
  name: "week PPR",
  ttlMs: FEED_POLICY.weekPpr.serverTtlMs,
  attemptTimeoutMs: 25_000,
  deadlineMs: 30_000,
  maxAttempts: 1,
  failureCooldownMs: 3_000,
  load: () => build(),
});

export async function weekPprResponse(): Promise<FeedResponse<WeekPpr>> {
  const result = await loader.get({ waitMs: 20_000 });
  const retrieval = result.ok ? result.fetchedAt : result.stale?.fetchedAt;
  return toFeedResponse(
    result,
    (b) => (retrieval == null ? b.ppr : { ...b.ppr, fetchedAt: new Date(retrieval).toISOString() }),
    Date.now(),
    (b) => b.partial,
  );
}
