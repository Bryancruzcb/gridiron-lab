import { dstPpr, fetchScoreboardRaw, fetchSummaryRaw, parseScoreboard, parseSummary } from "./espn.server";
import { positionMap, weekPlayers } from "./season.server";
import { nameTeamKey } from "./names";
import type { WeekPpr, WeekSkill } from "./types";

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
      return parseSummary(summary, g, null, posMap);
    } catch {
      return null;
    }
  });

  const byKey = new Map<string, WeekSkill>();
  const put = (row: WeekSkill) => {
    const k = nameTeamKey(row.name, row.team) || row.espnId;
    const prev = byKey.get(k);
    if (!prev || row.ppr >= prev.ppr) byKey.set(k, row);
  };

  for (const d of details) {
    if (!d) continue;
    for (const p of d.players) {
      put({
        gsisId: null,
        espnId: p.id,
        name: p.name,
        team: p.team,
        pos: p.pos === "FLEX" ? "WR" : p.pos,
        ppr: p.ppr,
        headshot: p.headshot,
        status: d.game.status,
      });
    }
    const away = d.game.away;
    const home = d.game.home;
    for (const tb of d.teamBox) {
      const opp = tb.abbr === home.abbr ? away.score : home.score;
      put({
        gsisId: null,
        espnId: `DST-${tb.abbr}`,
        name: `${tb.abbr} D/ST`,
        team: tb.abbr,
        pos: "DST",
        ppr: dstPpr({
          pa: opp,
          sacks: tb.sacks ?? 0,
          ints: tb.ints ?? 0,
          turnovers: tb.turnovers ?? 0,
          defTd: tb.defTd ?? 0,
        }),
        headshot: null,
        status: d.game.status,
      });
    }
  }

  if (week) {
    for (const row of week.rows) {
      const k = nameTeamKey(row.name, row.team);
      const existing = byKey.get(k);
      const skillPos =
        row.pos === "QB" || row.pos === "RB" || row.pos === "WR" || row.pos === "TE" ? row.pos : existing?.pos ?? "FLEX";
      if (existing) {
        existing.gsisId = row.id;
        if (existing.status === "post" && row.ppr) existing.ppr = row.ppr;
        if (skillPos !== "FLEX") existing.pos = skillPos;
      } else {
        put({
          gsisId: row.id,
          espnId: row.id,
          name: row.name,
          team: row.team,
          pos: skillPos === "FLEX" ? "WR" : skillPos,
          ppr: row.ppr,
          headshot: row.headshot,
          status: "post",
        });
      }
    }
  }

  return {
    season: board.season,
    week: board.week,
    fetchedAt: new Date().toISOString(),
    gamesFinal: board.games.filter((g) => g.status === "post").length,
    gamesLive: board.games.filter((g) => g.status === "in").length,
    games: board.games.length,
    players: [...byKey.values()].sort((a, b) => b.ppr - a.ppr),
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
