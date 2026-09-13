import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { parseScoreboard } from "../../src/lib/football/espn.ts";
import { emptyFeed, FEED_POLICY, receive, snapshotFeed, viewFeed } from "../../src/lib/live/feed-state.ts";
import {
  FIXTURE_SCENARIOS,
  fixtureResponse,
  parseFixtureSpec,
  scenarioFor,
  type FixtureBase,
} from "../../src/lib/live/fixture-scenarios.ts";
import type { SeasonLabs, WeekPpr } from "../../src/lib/live/types.ts";

const FIX = "tests/fixtures/football";
const read = <T>(name: string) => JSON.parse(readFileSync(`${FIX}/${name}`, "utf8")) as T;
const LABS = read<SeasonLabs>("live-labs.json");
const WEEK = read<WeekPpr>("live-weekppr.json");
const SNAP = JSON.parse(readFileSync("src/data/season2026.json", "utf8")) as SeasonLabs;
const NOW = Date.parse("2026-09-20T18:00:00.000Z");

const labsBase: FixtureBase<SeasonLabs> = {
  upstream: "nflverse",
  data: LABS,
  empty: { ...LABS, qbs: [], teams: [] },
  partial: { data: { ...LABS, teams: [] }, notes: ["team play-calling rows"] },
  serverTtlMs: FEED_POLICY.labs.serverTtlMs,
  freshForMs: FEED_POLICY.labs.freshForMs,
};

describe("fixture spec", () => {
  it("applies one scenario to every feed or sets feeds one by one", () => {
    const all = parseFixtureSpec("stale");
    assert.equal(scenarioFor(all, "labs"), "stale");
    assert.equal(scenarioFor(all, "detail"), "stale");
    const mixed = parseFixtureSpec("scoreboard:fresh|labs=unavailable, weekPpr:partial nonce:42 bogus:fresh");
    assert.equal(scenarioFor(mixed, "scoreboard"), "fresh");
    assert.equal(scenarioFor(mixed, "labs"), "unavailable");
    assert.equal(scenarioFor(mixed, "weekPpr"), "partial");
    assert.equal(scenarioFor(mixed, "detail"), null);
    assert.equal(scenarioFor(parseFixtureSpec("all:empty|labs:fresh"), "scoreboard"), "empty");
  });
});

describe("fixture scenarios through the client state", () => {
  const view = (scenario: (typeof FIXTURE_SCENARIOS)[number], call = 1) => {
    const res = fixtureResponse(scenario, labsBase, { nowMs: NOW, call });
    const state = receive(snapshotFeed(SNAP, SNAP.fetchedAt), res, new Date(NOW).toISOString());
    return { res, state, view: viewFeed(state, { nowMs: NOW, freshForMs: FEED_POLICY.labs.freshForMs }) };
  };

  it("fresh and cached are both fresh, with their own sources", () => {
    const fresh = view("fresh");
    assert.equal(fresh.view.kind === "data" && fresh.view.source, "live");
    assert.equal(fresh.view.kind === "data" && fresh.view.freshness, "fresh");
    const cached = view("cached");
    assert.equal(cached.view.kind === "data" && cached.view.source, "cache");
    assert.equal(cached.view.kind === "data" && cached.view.freshness, "fresh");
  });

  it("stale keeps usable rows, marks them stale and carries a retryable error", () => {
    const { res, state, view: v } = view("stale");
    assert.equal(res.fetchedAt, new Date(NOW - FEED_POLICY.labs.freshForMs * 3).toISOString());
    assert.equal(state.data, LABS);
    assert.equal(v.kind === "data" && v.freshness, "stale");
    assert.equal(v.kind === "data" && v.error?.retryable, true);
  });

  it("snapshot-only, unavailable and malformed leave the snapshot and its timestamp", () => {
    for (const scenario of ["snapshot-only", "unavailable", "malformed"] as const) {
      const { state } = view(scenario);
      assert.equal(state.sourceKind, "snapshot", scenario);
      assert.equal(state.dataAsOf, SNAP.fetchedAt, scenario);
    }
    assert.equal(view("malformed").state.error?.code, "schema");
    assert.equal(view("malformed").state.error?.retryable, false);
    const noSnapshot = receive(
      emptyFeed<SeasonLabs>(),
      fixtureResponse("unavailable", labsBase, { nowMs: NOW, call: 1 }),
      new Date(NOW).toISOString(),
    );
    assert.equal(viewFeed(noSnapshot, { nowMs: NOW, freshForMs: 1 }).kind, "unavailable");
  });

  it("empty and partial are successful responses", () => {
    const empty = view("empty");
    assert.equal(empty.state.error, null);
    assert.equal(empty.state.data?.qbs.length, 0);
    const partial = view("partial");
    assert.deepEqual(partial.state.partial, ["team play-calling rows"]);
  });

  it("recovered fails the first call and succeeds after", () => {
    assert.equal(view("recovered", 1).state.error?.code, "network");
    assert.equal(view("recovered", 2).state.error, null);
    assert.equal(view("recovered", 2).state.sourceKind, "live");
  });
});

describe("live fixture files", () => {
  it("scoreboard parses into one live, one final and one pregame game with a full week key", () => {
    const board = parseScoreboard(read<Record<string, unknown>>("live-scoreboard.json"), new Set());
    assert.deepEqual(board.weekKey, { season: 2026, seasonType: "REG", week: 2 });
    assert.deepEqual(board.games.map((g) => g.status), ["in", "post", "pre"]);
    assert.equal(board.anyLive, true);
    assert.equal(board.games[0]?.id, "401772854");
  });

  it("labs carry observed weekly rows and weekly PPR mixes provisional, published and partial lines", () => {
    assert.equal(LABS.throughWeek, 2);
    assert.ok(LABS.qbs.every((q) => (q.weeks?.length ?? 0) === 2));
    assert.ok(WEEK.players.some((p) => p.source === "espn"));
    assert.ok(WEEK.players.some((p) => p.source === "nflverse"));
    assert.ok(WEEK.players.some((p) => p.score.status === "partial"));
  });
});
