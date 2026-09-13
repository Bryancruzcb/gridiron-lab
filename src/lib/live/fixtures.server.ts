/**
 * Deterministic live-data switch for browser tests. Off unless the server process has
 * GRIDIRON_LIVE_FIXTURE set; with it unset every function here returns null at once.
 *
 *   GRIDIRON_LIVE_FIXTURE=stale                                 every feed answers "stale"
 *   GRIDIRON_LIVE_FIXTURE="labs:unavailable|scoreboard:fresh"   per feed: scoreboard, labs, weekPpr, detail
 *   GRIDIRON_LIVE_FIXTURE=cookie                                read the same spec per request from the
 *                                                               gl_live_fixture cookie (one preview server,
 *                                                               every scenario; no cookie means "fresh")
 *
 * Scenarios: fresh, cached, stale, snapshot-only, partial, empty, unavailable, malformed, recovered.
 * "recovered" fails the first request per feed for a given spec string, then answers fresh; add an
 * ignored token such as "nonce:7" to start over. Feeds the spec does not name answer "fresh".
 *
 * Base data is read from tests/fixtures/football/live-*.json (under the process cwd, or
 * GRIDIRON_LIVE_FIXTURE_DIR). Nothing here calls ESPN or nflverse.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCookie } from "@tanstack/react-start/server";
import { parseScoreboard } from "../football/espn";
import { parseSummary } from "./espn.server";
import { FEED_POLICY } from "./feed-state";
import {
  fixtureResponse,
  parseFixtureSpec,
  scenarioFor,
  type FixtureBase,
  type FixtureFeed,
} from "./fixture-scenarios";
import type { FeedResponse, GameDetail, Scoreboard, SeasonLabs, WeekPpr } from "./types";

type FixtureData = { scoreboard: Scoreboard; labs: SeasonLabs; weekPpr: WeekPpr; detail: GameDetail };

export const FIXTURE_COOKIE = "gl_live_fixture";
const SUMMARY_EVENT = "401772854";
const calls = new Map<string, number>();

function readFixture<T>(name: string): T {
  const dir = process.env.GRIDIRON_LIVE_FIXTURE_DIR ?? join(process.cwd(), "tests", "fixtures", "football");
  return JSON.parse(readFileSync(join(dir, name), "utf8")) as T;
}

function spec(): string | null {
  const env = process.env.GRIDIRON_LIVE_FIXTURE;
  if (!env) return null;
  if (env !== "cookie") return env;
  const cookie = getCookie(FIXTURE_COOKIE);
  return cookie ? decodeURIComponent(cookie) : "fresh";
}

const policy = (feed: keyof typeof FEED_POLICY) => ({
  serverTtlMs: FEED_POLICY[feed].serverTtlMs,
  freshForMs: FEED_POLICY[feed].freshForMs,
});

function board(): Scoreboard {
  return parseScoreboard(readFixture<Record<string, unknown>>("live-scoreboard.json"), new Set());
}

function scoreboardBase(): FixtureBase<Scoreboard> {
  const data = board();
  return {
    upstream: "ESPN",
    data,
    empty: { ...data, anyLive: false, games: [] },
    partial: {
      data: { ...data, seasonType: null, weekKey: null },
      notes: ["ESPN left out the season, season type or week"],
    },
    ...policy("scoreboard"),
  };
}

function labsBase(): FixtureBase<SeasonLabs> {
  const data = readFixture<SeasonLabs>("live-labs.json");
  return {
    upstream: "nflverse",
    data,
    empty: { ...data, throughWeek: 0, qbs: [], teams: [] },
    partial: { data: { ...data, teams: [] }, notes: ["team play-calling rows (not in the live file yet)"] },
    ...policy("labs"),
  };
}

function weekPprBase(): FixtureBase<WeekPpr> {
  const data = readFixture<WeekPpr>("live-weekppr.json");
  return {
    upstream: "ESPN",
    data,
    empty: { ...data, games: 0, gamesFinal: 0, gamesLive: 0, players: [] },
    partial: {
      data: { ...data, players: data.players.filter((p) => p.team !== "BUF" && p.team !== "MIA") },
      notes: ["box score for BUF@MIA"],
    },
    ...policy("weekPpr"),
  };
}

function detailBase(eventId: string | undefined): FixtureBase<GameDetail> | null {
  const game = board().games.find((g) => g.id === eventId);
  if (!game) return null;
  const summary =
    eventId === SUMMARY_EVENT ? readFixture<Record<string, unknown>>(`espn_summary_${SUMMARY_EVENT}.json`) : {};
  const data = parseSummary(summary, game, null);
  return {
    upstream: "ESPN",
    data,
    empty: parseSummary({}, game, null),
    partial: { data: { ...data, scoring: [] }, notes: ["scoring plays"] },
    ...policy("detail"),
  };
}

function base(feed: FixtureFeed, eventId?: string): FixtureBase<unknown> | null {
  switch (feed) {
    case "scoreboard":
      return scoreboardBase();
    case "labs":
      return labsBase();
    case "weekPpr":
      return weekPprBase();
    case "detail":
      return detailBase(eventId);
  }
}

export function fixtureFeedResponse<K extends FixtureFeed>(feed: K, eventId?: string): FeedResponse<FixtureData[K]> | null {
  const raw = spec();
  if (raw == null) return null;
  const nowMs = Date.now();
  const b = base(feed, eventId);
  if (!b) {
    return {
      data: null,
      source: "none",
      fetchedAt: null,
      respondedAt: new Date(nowMs).toISOString(),
      error: { code: "not-found", message: "Game not on this week's board (fixture)", retryable: false, retryAfterMs: null },
      partial: [],
    };
  }
  const key = `${raw}|${feed}`;
  const call = (calls.get(key) ?? 0) + 1;
  calls.set(key, call);
  const res = fixtureResponse(scenarioFor(parseFixtureSpec(raw), feed) ?? "fresh", b, { nowMs, call });
  // Keep the payload's own timestamp in step with the retrieval time the response reports.
  if (res.data && res.fetchedAt && typeof res.data === "object" && "fetchedAt" in res.data) {
    return { ...res, data: { ...res.data, fetchedAt: res.fetchedAt } } as FeedResponse<FixtureData[K]>;
  }
  return res as FeedResponse<FixtureData[K]>;
}
