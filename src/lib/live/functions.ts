import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchScoreboardRaw, fetchSummaryRaw, parseScoreboard, parseSummary } from "./espn.server";
import { seedPosMap } from "./names";
import { bustSeasonCache, loadSeasonLabs, peekAdvanced, peekAdvancedKeys, peekPosMap, warmNflverse } from "./season.server";
import { loadWeekPpr } from "./weekppr.server";
import type { GameDetail, Scoreboard, SeasonLabs, WeekPpr } from "./types";

export const getScoreboard = createServerFn({ method: "GET" }).handler(async (): Promise<Scoreboard> => {
  warmNflverse();
  const raw = await fetchScoreboardRaw();
  return parseScoreboard(raw, peekAdvancedKeys());
});

export const getGameDetail = createServerFn({ method: "POST" })
  .validator(z.object({ eventId: z.string().regex(/^\d{6,12}$/) }))
  .handler(async ({ data }): Promise<GameDetail> => {
    warmNflverse();
    const [rawBoard, summary] = await Promise.all([
      fetchScoreboardRaw(),
      fetchSummaryRaw(data.eventId),
    ]);
    const board = parseScoreboard(rawBoard, peekAdvancedKeys());
    const game = board.games.find((g) => g.id === data.eventId);
    if (!game) throw new Error("Game not on this week's board");
    const pos = peekPosMap() ?? seedPosMap();
    const advanced = game.status === "pre" ? null : peekAdvanced(game.nflverseKey);
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
