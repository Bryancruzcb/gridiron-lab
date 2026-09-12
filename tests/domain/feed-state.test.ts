import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  emptyFeed,
  fail,
  FEED_POLICY,
  mergeLabs,
  receive,
  snapshotFeed,
  startAttempt,
  transportError,
  viewFeed,
  type FeedState,
} from "../../src/lib/live/feed-state.ts";
import type { FeedError, FeedResponse, SeasonLabs } from "../../src/lib/live/types.ts";

const SNAP = JSON.parse(readFileSync("src/data/season2026.json", "utf8")) as SeasonLabs;
const LIVE = JSON.parse(readFileSync("tests/fixtures/football/live-labs.json", "utf8")) as SeasonLabs;
const SNAP_AT = SNAP.fetchedAt;

const T0 = Date.parse("2026-09-19T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

const NETWORK: FeedError = { code: "network", message: "Couldn't reach nflverse", retryable: true, retryAfterMs: null };

function response<T>(overrides: Partial<FeedResponse<T>>): FeedResponse<T> {
  return { data: null, source: "none", fetchedAt: null, respondedAt: iso(T0), error: null, partial: [], ...overrides };
}

describe("feed state: timestamps belong to the data", () => {
  it("keeps a snapshot's old timestamp after a failed request", () => {
    const initial = snapshotFeed(SNAP, SNAP_AT);
    const attempt = startAttempt(initial, iso(T0));
    const failed = receive(attempt, response<SeasonLabs>({ error: NETWORK }), iso(T0 + 1000));
    assert.equal(failed.dataAsOf, SNAP_AT);
    assert.equal(failed.sourceKind, "snapshot");
    assert.equal(failed.data, SNAP);
    assert.equal(failed.lastSuccessfulFetchAt, null);
    assert.deepEqual(failed.error, NETWORK);
    assert.equal(failed.isRefreshing, false);

    const thrown = fail(startAttempt(initial, iso(T0)), transportError(new Error("fetch failed")));
    assert.equal(thrown.dataAsOf, SNAP_AT);
    assert.equal(thrown.lastSuccessfulFetchAt, null);
    assert.equal(thrown.error?.code, "network");
    assert.equal(viewFeed(thrown, { nowMs: T0, freshForMs: FEED_POLICY.labs.freshForMs }).kind, "data");
  });

  it("never stamps live data with the time of a failed attempt", () => {
    const live = receive(
      startAttempt(emptyFeed<SeasonLabs>(), iso(T0)),
      response({ data: LIVE, source: "live", fetchedAt: iso(T0) }),
      iso(T0 + 500),
    );
    assert.equal(live.dataAsOf, iso(T0));
    assert.equal(live.lastSuccessfulFetchAt, iso(T0 + 500));

    const later = T0 + 30 * MIN;
    const failed = receive(startAttempt(live, iso(later)), response<SeasonLabs>({ error: NETWORK }), iso(later + 10));
    assert.equal(failed.data, LIVE);
    assert.equal(failed.dataAsOf, iso(T0));
    assert.equal(failed.lastSuccessfulFetchAt, iso(T0 + 500));
    assert.equal(failed.lastAttemptAt, iso(later));
    assert.equal(failed.error, NETWORK);
  });

  it("takes a server's last good retrieval with that retrieval's own time, not the response time", () => {
    const retrievedAt = iso(T0 - 90 * MIN);
    const next = receive(
      snapshotFeed(SNAP, SNAP_AT),
      response({ data: LIVE, source: "cache", fetchedAt: retrievedAt, error: NETWORK }),
      iso(T0),
    );
    assert.equal(next.sourceKind, "cache");
    assert.equal(next.dataAsOf, retrievedAt);
    assert.equal(next.lastSuccessfulFetchAt, null, "a failed request is not a successful fetch");
    const view = viewFeed(next, { nowMs: T0, freshForMs: FEED_POLICY.labs.freshForMs });
    assert.equal(view.kind === "data" && view.freshness, "stale");
    assert.equal(view.kind === "data" && view.error?.code, "network");
  });

  it("ignores a stale server cache older than the rows already shown", () => {
    const current = receive(emptyFeed<SeasonLabs>(), response({ data: LIVE, source: "live", fetchedAt: iso(T0) }), iso(T0));
    const older = receive(
      current,
      response({ data: SNAP, source: "cache", fetchedAt: iso(T0 - 5 * MIN), error: NETWORK }),
      iso(T0 + MIN),
    );
    assert.equal(older.data, LIVE);
    assert.equal(older.dataAsOf, iso(T0));
  });

  it("never trades newer rows for an older successful cache from another server instance", () => {
    const current = receive(emptyFeed<SeasonLabs>(), response({ data: LIVE, source: "live", fetchedAt: iso(T0) }), iso(T0));
    const next = receive(current, response({ data: SNAP, source: "cache", fetchedAt: iso(T0 - MIN) }), iso(T0 + MIN));
    assert.equal(next.data, LIVE);
    assert.equal(next.dataAsOf, iso(T0));
    assert.equal(next.lastSuccessfulFetchAt, iso(T0 + MIN));
    assert.equal(next.error, null);
  });

  it("reports a fresh cached response with its source and real age", () => {
    const cached = receive(
      emptyFeed<SeasonLabs>(),
      response({ data: LIVE, source: "cache", fetchedAt: iso(T0 - 6_000) }),
      iso(T0),
    );
    const view = viewFeed(cached, { nowMs: T0, freshForMs: FEED_POLICY.scoreboard.freshForMs });
    assert.equal(view.kind, "data");
    if (view.kind !== "data") return;
    assert.equal(view.source, "cache");
    assert.equal(view.freshness, "fresh", "cached within the window is not stale");
    assert.equal(view.ageMs, 6_000);
    const later = viewFeed(cached, { nowMs: T0 + 4 * MIN, freshForMs: FEED_POLICY.scoreboard.freshForMs });
    assert.equal(later.kind === "data" && later.freshness, "stale");
  });

  it("keeps previous valid data on a refresh error and recovers on retry", () => {
    const good = receive(emptyFeed<SeasonLabs>(), response({ data: LIVE, source: "live", fetchedAt: iso(T0) }), iso(T0));
    const refreshing = startAttempt(good, iso(T0 + MIN));
    assert.equal(refreshing.data, LIVE, "a refresh does not clear data first");
    assert.equal(viewFeed(refreshing, { nowMs: T0 + MIN, freshForMs: MIN * 45 }).kind, "data");
    const failed = receive(refreshing, response<SeasonLabs>({ error: NETWORK }), iso(T0 + MIN));
    assert.equal(failed.data, LIVE);
    const retried = receive(
      startAttempt(failed, iso(T0 + 2 * MIN)),
      response({ data: LIVE, source: "live", fetchedAt: iso(T0 + 2 * MIN) }),
      iso(T0 + 2 * MIN),
    );
    assert.equal(retried.error, null);
    assert.equal(retried.dataAsOf, iso(T0 + 2 * MIN));
    assert.equal(retried.lastSuccessfulFetchAt, iso(T0 + 2 * MIN));
  });

  it("treats a success without data as a schema failure", () => {
    const next = receive(snapshotFeed(SNAP, SNAP_AT), response<SeasonLabs>({ source: "live" }), iso(T0));
    assert.equal(next.error?.code, "schema");
    assert.equal(next.dataAsOf, SNAP_AT);
  });
});

describe("feed view", () => {
  const board = { games: [] as unknown[] };
  const isEmpty = (d: { games: unknown[] }) => d.games.length === 0;

  it("is loading before the first answer and unavailable after a failure with no data", () => {
    const opts = { nowMs: T0, freshForMs: MIN, isEmpty };
    assert.equal(viewFeed(emptyFeed<typeof board>(), opts).kind, "loading");
    const attempt = startAttempt(emptyFeed<typeof board>(), iso(T0));
    assert.equal(viewFeed(attempt, opts).kind, "loading");
    const failed = receive(attempt, response<typeof board>({ error: NETWORK }), iso(T0));
    const view = viewFeed(failed, opts);
    assert.equal(view.kind, "unavailable");
    assert.equal(view.kind === "unavailable" && view.error?.code, "network");
    const retrying = viewFeed(startAttempt(failed, iso(T0 + 1)), opts);
    assert.equal(retrying.kind, "unavailable", "a retry does not flicker back to loading");
    assert.equal(retrying.kind === "unavailable" && retrying.refreshing, true);
  });

  it("distinguishes an empty successful response from a failed request", () => {
    const empty = receive(emptyFeed<typeof board>(), response({ data: board, source: "live", fetchedAt: iso(T0) }), iso(T0));
    const view = viewFeed(empty, { nowMs: T0, freshForMs: MIN, isEmpty });
    assert.equal(view.kind, "data");
    assert.equal(view.kind === "data" && view.empty, true);
    assert.equal(view.kind === "data" && view.error, null);
  });

  it("passes partial notes through and hides them for a snapshot section", () => {
    const partial = receive(
      emptyFeed<SeasonLabs>(),
      response({ data: LIVE, source: "live", fetchedAt: iso(T0), partial: ["team rows"] }),
      iso(T0),
    );
    const live = viewFeed(partial, { nowMs: T0, freshForMs: MIN });
    assert.deepEqual(live.kind === "data" && live.partial, ["team rows"]);
    const { sections } = mergeLabs(partial, SNAP);
    const snapView = viewFeed(partial, { nowMs: T0, freshForMs: MIN, section: { ...sections.qbs, kind: "snapshot", asOf: SNAP_AT } });
    assert.equal(snapView.kind === "data" && snapView.source, "snapshot");
    assert.deepEqual(snapView.kind === "data" && snapView.partial, []);
  });

  it("says unknown freshness until the client has a clock", () => {
    const live = receive(emptyFeed<SeasonLabs>(), response({ data: LIVE, source: "live", fetchedAt: iso(T0) }), iso(T0));
    const view = viewFeed(live, { nowMs: null, freshForMs: MIN });
    assert.equal(view.kind === "data" && view.freshness, "unknown");
  });
});

describe("labs provenance", () => {
  it("labels live QB rows and snapshot team rows separately", () => {
    const partialLive: SeasonLabs = { ...LIVE, teams: [] };
    const feed = receive(emptyFeed<SeasonLabs>(), response({ data: partialLive, source: "live", fetchedAt: iso(T0) }), iso(T0));
    const { labs, sections } = mergeLabs(feed, SNAP);
    assert.deepEqual(sections.qbs, { kind: "live", asOf: iso(T0), throughWeek: 2 });
    assert.deepEqual(sections.teams, { kind: "snapshot", asOf: SNAP_AT, throughWeek: SNAP.throughWeek });
    assert.equal(labs.qbs, partialLive.qbs);
    assert.equal(labs.teams, SNAP.teams);
    assert.equal(labs.fetchedAt, SNAP_AT, "the bundle time is its oldest section");
    assert.match(labs.source, /live QB rows, snapshot team rows/);
  });

  it("uses the snapshot with its own time when the live feed failed", () => {
    const failed = receive(snapshotFeed(SNAP, SNAP_AT), response<SeasonLabs>({ error: NETWORK }), iso(T0));
    const { labs, sections } = mergeLabs(failed, SNAP);
    assert.equal(sections.qbs.kind, "snapshot");
    assert.equal(sections.teams.asOf, SNAP_AT);
    assert.equal(labs.fetchedAt, SNAP_AT);
    assert.equal(labs.throughWeek, SNAP.throughWeek);
  });

  it("never synthesizes a single-week point from season totals", () => {
    const { labs } = mergeLabs(snapshotFeed(SNAP, SNAP_AT), SNAP);
    for (const q of labs.qbs) assert.equal(q.weeks, undefined, `${q.name} has no observed weekly rows in the snapshot`);
    const live = receive(emptyFeed<SeasonLabs>(), response({ data: LIVE, source: "live", fetchedAt: iso(T0) }), iso(T0));
    assert.deepEqual(
      mergeLabs(live, SNAP).labs.qbs.map((q) => q.weeks?.length),
      LIVE.qbs.map((q) => q.weeks?.length),
    );
  });

  it("marks both sections cached when the rows came from a server cache", () => {
    const feed: FeedState<SeasonLabs> = receive(
      emptyFeed<SeasonLabs>(),
      response({ data: LIVE, source: "cache", fetchedAt: iso(T0 - MIN) }),
      iso(T0),
    );
    const { labs, sections } = mergeLabs(feed, SNAP);
    assert.equal(sections.qbs.kind, "cache");
    assert.equal(sections.teams.kind, "cache");
    assert.equal(labs.fetchedAt, iso(T0 - MIN));
    assert.equal(labs.source, LIVE.source);
  });
});
