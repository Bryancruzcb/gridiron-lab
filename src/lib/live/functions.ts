import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchScoreboardRaw, fetchSummaryRaw, parseScoreboard, parseSummary } from "./espn.server";
import { advancedFor, advancedKeys, bustSeasonCache, loadSeasonLabs, positionMap } from "./season.server";
import { loadWeekPpr } from "./weekppr.server";
import type { GameDetail, Scoreboard, SeasonLabs, WeekPpr } from "./types";

async function keysWithBudget(ms: number) {
  try {
    return await Promise.race([
      advancedKeys(),
      new Promise<Set<string>>((resolve) => setTimeout(() => resolve(new Set()), ms)),
    ]);
  } catch {
    return new Set<string>();
  }
}

export const getScoreboard = createServerFn({ method: "GET" }).handler(async (): Promise<Scoreboard> => {
  const [raw, keys] = await Promise.all([fetchScoreboardRaw(), keysWithBudget(2500)]);
  return parseScoreboard(raw, keys);
});

export const getGameDetail = createServerFn({ method: "POST" })
  .validator(z.object({ eventId: z.string().regex(/^\d{6,12}$/) }))
  .handler(async ({ data }): Promise<GameDetail> => {
    const [rawBoard, keys, summary, pos] = await Promise.all([
      fetchScoreboardRaw(),
      advancedKeys(),
      fetchSummaryRaw(data.eventId),
      positionMap().catch(() => undefined),
    ]);
    const board = parseScoreboard(rawBoard, keys);
    const game = board.games.find((g) => g.id === data.eventId);
    if (!game) throw new Error("Game not on this week's board");
    const advanced = game.status === "pre" ? null : await advancedFor(game.nflverseKey);
    return parseSummary(summary, game, advanced, pos);
  });

export const getSeasonLabs = createServerFn({ method: "GET" }).handler(async (): Promise<SeasonLabs> => {
  try {
    return await Promise.race([
      loadSeasonLabs(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("season timeout")), 12000)),
    ]);
  } catch {
    return {
      season: 2026,
      throughWeek: 0,
      fetchedAt: new Date().toISOString(),
      source: "nflverse unavailable — showing last snapshot",
      qbs: [],
      teams: [],
    };
  }
});

export const getWeekPpr = createServerFn({ method: "GET" }).handler(async (): Promise<WeekPpr> => {
  return loadWeekPpr();
});

export const refreshSeason = createServerFn({ method: "POST" }).handler(async (): Promise<SeasonLabs> => {
  bustSeasonCache();
  return loadSeasonLabs();
});
