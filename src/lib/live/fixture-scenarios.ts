// Named live-response scenarios for deterministic browser tests. Pure: the server switch in
// fixtures.server.ts supplies base data, the clock and the spec string.

import type { FeedResponse } from "./types.ts";

export const FIXTURE_SCENARIOS = [
  "fresh",
  "cached",
  "stale",
  "snapshot-only",
  "partial",
  "empty",
  "unavailable",
  "malformed",
  "recovered",
] as const;
export type FixtureScenario = (typeof FIXTURE_SCENARIOS)[number];

export const FIXTURE_FEEDS = ["scoreboard", "labs", "weekPpr", "detail"] as const;
export type FixtureFeed = (typeof FIXTURE_FEEDS)[number];

export type FixtureSpec = { byFeed: Partial<Record<FixtureFeed, FixtureScenario>>; all: FixtureScenario | null };

function isScenario(v: string): v is FixtureScenario {
  return (FIXTURE_SCENARIOS as readonly string[]).includes(v);
}

function isFeed(v: string): v is FixtureFeed {
  return (FIXTURE_FEEDS as readonly string[]).includes(v);
}

/**
 * "stale" applies to every feed; "labs:unavailable|scoreboard:fresh" sets feeds one by one ("=" also
 * works; tokens split on "|", "," or spaces). Unknown tokens are ignored, so "nonce:abc" can make a
 * spec unique for the per-spec "recovered" counter.
 */
export function parseFixtureSpec(spec: string): FixtureSpec {
  const out: FixtureSpec = { byFeed: {}, all: null };
  for (const token of spec.split(/[|,\s]+/)) {
    if (!token) continue;
    const [left = "", right] = token.split(/[:=]/, 2);
    if (right == null) {
      if (isScenario(left)) out.all = left;
      continue;
    }
    if ((left === "all" || left === "*") && isScenario(right)) out.all = right;
    else if (isFeed(left) && isScenario(right)) out.byFeed[left] = right;
  }
  return out;
}

export function scenarioFor(spec: FixtureSpec, feed: FixtureFeed): FixtureScenario | null {
  return spec.byFeed[feed] ?? spec.all;
}

export type FixtureBase<T> = {
  /** Name of the upstream in error messages, e.g. "ESPN". */
  upstream: string;
  data: T;
  empty: T;
  partial: { data: T; notes: string[] };
  serverTtlMs: number;
  freshForMs: number;
};

export function fixtureResponse<T>(
  scenario: FixtureScenario,
  base: FixtureBase<T>,
  clock: { nowMs: number; call: number },
): FeedResponse<T> {
  const { nowMs } = clock;
  const at = (ageMs: number) => new Date(nowMs - ageMs).toISOString();
  const respondedAt = at(0);
  const ok = (data: T, source: "live" | "cache", ageMs: number, partial: string[] = []): FeedResponse<T> => ({
    data,
    source,
    fetchedAt: at(ageMs),
    respondedAt,
    error: null,
    partial,
  });
  const down: FeedResponse<T> = {
    data: null,
    source: "none",
    fetchedAt: null,
    respondedAt,
    error: { code: "network", message: `Couldn't reach ${base.upstream} (fixture)`, retryable: true, retryAfterMs: null },
    partial: [],
  };
  switch (scenario) {
    case "fresh":
      return ok(base.data, "live", 2_000);
    case "cached":
      return ok(base.data, "cache", Math.floor(Math.min(base.serverTtlMs, base.freshForMs) / 2));
    case "stale":
      return { ...ok(base.data, "cache", base.freshForMs * 3), error: down.error };
    case "snapshot-only":
      return {
        ...down,
        error: { code: "http", message: `${base.upstream} has no file for this season yet (404, fixture)`, retryable: false, retryAfterMs: null },
      };
    case "partial":
      return ok(base.partial.data, "live", 2_000, base.partial.notes);
    case "empty":
      return ok(base.empty, "live", 2_000);
    case "unavailable":
      return down;
    case "malformed":
      return {
        ...down,
        error: {
          code: "schema",
          message: `${base.upstream} answered in a shape the parser does not accept (fixture)`,
          retryable: false,
          retryAfterMs: null,
        },
      };
    case "recovered":
      return clock.call <= 1 ? down : ok(base.data, "live", 2_000);
  }
}
