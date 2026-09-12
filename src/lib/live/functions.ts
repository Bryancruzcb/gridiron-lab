import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadScoreboardRaw, loadSummaryRaw, parseScoreboard, parseSummary, scoreboardResponse } from "./espn.server";
import { fixtureFeedResponse } from "./fixtures.server";
import { toFeedResponse } from "./loader";
import { seedPosMap } from "./names";
import { peekAdvanced, peekAdvancedKeys, peekPosMap, seasonLabsResponse, warmNflverse } from "./season.server";
import type { FeedResponse, GameDetail, Scoreboard, SeasonLabs, WeekPpr } from "./types";
import { weekPprResponse } from "./weekppr.server";

// Every handler answers with what actually happened upstream (FeedResponse), never empty rows
// stamped with the current time. GRIDIRON_LIVE_FIXTURE swaps in named fixtures; see fixtures.server.ts.

export const getScoreboard = createServerFn({ method: "GET" }).handler(async (): Promise<FeedResponse<Scoreboard>> => {
  const fixture = fixtureFeedResponse("scoreboard");
  if (fixture) return fixture;
  warmNflverse();
  return scoreboardResponse(peekAdvancedKeys());
});

export const getGameDetail = createServerFn({ method: "POST" })
  .validator(z.object({ eventId: z.string().regex(/^\d{6,12}$/) }))
  .handler(async ({ data }): Promise<FeedResponse<GameDetail>> => {
    const fixture = fixtureFeedResponse("detail", data.eventId);
    if (fixture) return fixture;
    warmNflverse();
    const [board, summary] = await Promise.all([loadScoreboardRaw(), loadSummaryRaw(data.eventId)]);
    const now = Date.now();
    const rawBoard = board.ok ? board.data : board.stale?.data;
    const game = rawBoard
      ? parseScoreboard(rawBoard, peekAdvancedKeys()).games.find((g) => g.id === data.eventId)
      : undefined;
    if (!game) {
      const error =
        !board.ok && !rawBoard
          ? board.error
          : { code: "not-found" as const, message: "Game not on this week's board", retryable: false, retryAfterMs: null };
      return { data: null, source: "none", fetchedAt: null, respondedAt: new Date(now).toISOString(), error, partial: [] };
    }
    const pos = peekPosMap() ?? seedPosMap();
    const advanced = game.status === "pre" ? null : peekAdvanced(game.nflverseKey);
    return toFeedResponse(summary, (raw) => parseSummary(raw, game, advanced, pos), now);
  });

export const getSeasonLabs = createServerFn({ method: "GET" }).handler(async (): Promise<FeedResponse<SeasonLabs>> => {
  return fixtureFeedResponse("labs") ?? seasonLabsResponse();
});

export const getWeekPpr = createServerFn({ method: "GET" }).handler(async (): Promise<FeedResponse<WeekPpr>> => {
  return fixtureFeedResponse("weekPpr") ?? weekPprResponse();
});

/** Re-downloads the season files if the cached copies are over a minute old; last good data stays as fallback. */
export const refreshSeason = createServerFn({ method: "POST" }).handler(async (): Promise<FeedResponse<SeasonLabs>> => {
  return fixtureFeedResponse("labs") ?? seasonLabsResponse({ force: true });
});
