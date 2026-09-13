import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyFeed, snapshotFeed, type FeedState } from "../../src/lib/live/feed-state.ts";
import { createFeedStore } from "../../src/lib/live/feed-store.ts";
import type { Timers } from "../../src/lib/live/loader.ts";
import type { FeedError, FeedResponse } from "../../src/lib/live/types.ts";

const T0 = Date.parse("2026-09-19T12:00:00.000Z");

/** Manual clock: timers fire only inside advance(). */
function fakeTime() {
  let t = T0;
  let nextId = 0;
  const queue = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    setTimeout(fn, ms) {
      nextId += 1;
      queue.set(nextId, { at: t + ms, fn });
      return nextId;
    },
    clearTimeout(id) {
      queue.delete(id as number);
    },
  };
  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  };
  return {
    now: () => t,
    timers,
    pending: () => queue.size,
    flush,
    async advance(ms: number) {
      const end = t + ms;
      for (;;) {
        await flush();
        const due = [...queue.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        t = due[1].at;
        queue.delete(due[0]);
        due[1].fn();
        await flush();
      }
      t = end;
      await flush();
    },
  };
}

type Board = { games: number };
type Labs = { qbs: string[] };
type Feeds = { scoreboard: Board; labs: Labs };

const ok = <T>(data: T, fetchedAt: number): FeedResponse<T> => ({
  data,
  source: "live",
  fetchedAt: new Date(fetchedAt).toISOString(),
  respondedAt: new Date(fetchedAt).toISOString(),
  error: null,
  partial: [],
});

const PENDING: FeedError = { code: "pending", message: "still loading", retryable: true, retryAfterMs: 1_000 };

function setup(opts: {
  scoreboard?: () => Promise<FeedResponse<Board>>;
  labs?: () => Promise<FeedResponse<Labs>>;
  initialLabs?: FeedState<Labs>;
  isActive?: () => boolean;
  maxPendingFollowUps?: number;
}) {
  const time = fakeTime();
  const calls = { scoreboard: 0, labs: 0 };
  const store = createFeedStore<Feeds>({
    now: time.now,
    timers: time.timers,
    isActive: opts.isActive,
    maxPendingFollowUps: opts.maxPendingFollowUps,
    initial: { scoreboard: emptyFeed<Board>(), labs: opts.initialLabs ?? emptyFeed<Labs>() },
    fetchers: {
      scoreboard: () => {
        calls.scoreboard += 1;
        return opts.scoreboard ? opts.scoreboard() : Promise.resolve(ok({ games: calls.scoreboard }, time.now()));
      },
      labs: () => {
        calls.labs += 1;
        return opts.labs ? opts.labs() : Promise.resolve(ok({ qbs: ["Maye"] }, time.now()));
      },
    },
  });
  return { store, time, calls };
}

describe("feed store", () => {
  it("dedups concurrent refreshes of one feed", async () => {
    let release: (v: FeedResponse<Board>) => void = () => {};
    const { store, calls } = setup({ scoreboard: () => new Promise((r) => (release = r)) });
    const a = store.refresh("scoreboard");
    const b = store.refresh("scoreboard");
    assert.equal(a, b);
    assert.equal(calls.scoreboard, 1);
    assert.equal(store.getState().scoreboard.isRefreshing, true);
    release(ok({ games: 7 }, T0));
    await a;
    assert.deepEqual(store.getState().scoreboard.data, { games: 7 });
    assert.equal(store.getState().scoreboard.isRefreshing, false);
  });

  it("retries one feed without touching the others and keeps its good data on error", async () => {
    let failNext = false;
    const { store, calls } = setup({
      scoreboard: () => (failNext ? Promise.reject(new Error("offline")) : Promise.resolve(ok({ games: 3 }, T0))),
    });
    await store.refresh("scoreboard");
    await store.refresh("labs");
    const labsBefore = store.getState().labs;
    failNext = true;
    await store.refresh("scoreboard");
    const s = store.getState();
    assert.deepEqual(s.scoreboard.data, { games: 3 });
    assert.equal(s.scoreboard.dataAsOf, new Date(T0).toISOString());
    assert.equal(s.scoreboard.error?.code, "network");
    assert.equal(s.labs, labsBefore, "the other feed is not invalidated");
    assert.equal(calls.labs, 1);
    failNext = false;
    await store.refresh("scoreboard");
    assert.equal(store.getState().scoreboard.error, null);
  });

  it("keeps the snapshot's timestamp when the request itself fails", async () => {
    const snapAt = "2026-09-11T16:03:43.206Z";
    const { store } = setup({
      initialLabs: snapshotFeed({ qbs: ["snapshot"] }, snapAt),
      labs: () => Promise.reject(new Error("500")),
    });
    await store.refresh("labs");
    const labs = store.getState().labs;
    assert.equal(labs.sourceKind, "snapshot");
    assert.equal(labs.dataAsOf, snapAt);
    assert.deepEqual(labs.data, { qbs: ["snapshot"] });
    assert.equal(labs.lastSuccessfulFetchAt, null);
  });

  it("shares one polling timer between the provider and the live route, and stops when released", async () => {
    const { store, time, calls } = setup({});
    const stop = store.start();
    await time.flush();
    assert.equal(calls.scoreboard, 1, "initial load");
    const routeLease = store.poll("scoreboard", 15_000);
    const secondLease = store.poll("scoreboard", 15_000);
    await time.advance(1_000);
    assert.equal(calls.scoreboard, 1, "registering a poll does not refetch a feed that just loaded");
    await time.advance(14_000);
    assert.equal(calls.scoreboard, 2, "two subscribers, one fetch per interval");
    await time.advance(15_000);
    assert.equal(calls.scoreboard, 3);
    routeLease();
    secondLease();
    await time.advance(120_000);
    assert.equal(calls.scoreboard, 3, "no polling after every lease is released");
    stop();
    assert.equal(time.pending(), 0);
  });

  it("uses the shortest held interval and falls back when that lease goes", async () => {
    const { store, time, calls } = setup({});
    store.start();
    await time.flush();
    const slow = store.poll("scoreboard", 60_000);
    const fast = store.poll("scoreboard", 15_000);
    await time.advance(15_000);
    assert.equal(calls.scoreboard, 2);
    fast();
    await time.advance(45_000);
    assert.equal(calls.scoreboard, 2);
    await time.advance(15_000);
    assert.equal(calls.scoreboard, 3, "next fetch 60 s after the last attempt");
    slow();
  });

  it("does not start a second request when a poll registers during the initial load", async () => {
    let release: (v: FeedResponse<Board>) => void = () => {};
    const { store, time, calls } = setup({ scoreboard: () => new Promise((r) => (release = r)) });
    store.start();
    const lease = store.poll("scoreboard", 15_000);
    await time.advance(20_000);
    assert.equal(calls.scoreboard, 1);
    release(ok({ games: 1 }, time.now()));
    await time.flush();
    await time.advance(4_999);
    assert.equal(calls.scoreboard, 1, "a request slower than the interval still leaves a gap before the next poll");
    await time.advance(1);
    assert.equal(calls.scoreboard, 2);
    lease();
  });

  it("skips poll fetches while the tab is hidden", async () => {
    let visible = true;
    const { store, time, calls } = setup({ isActive: () => visible });
    store.start();
    await time.flush();
    const lease = store.poll("scoreboard", 10_000);
    visible = false;
    await time.advance(35_000);
    assert.equal(calls.scoreboard, 1);
    visible = true;
    await time.advance(10_000);
    assert.equal(calls.scoreboard, 2);
    lease();
  });

  it("starts delayed feeds after their delay and cancels them on stop", async () => {
    const { store, time, calls } = setup({});
    const stop = store.start({ labs: 1_500 });
    await time.advance(1_000);
    assert.equal(calls.labs, 0);
    stop();
    await time.advance(5_000);
    assert.equal(calls.labs, 0);
    assert.equal(time.pending(), 0);
    store.start({ labs: 1_500 });
    await time.advance(1_500);
    assert.equal(calls.labs, 1, "a remount picks the delayed load back up");
    assert.equal(calls.scoreboard, 1, "a feed already loaded is not refetched on remount");
  });

  it("follows a pending answer a bounded number of times", async () => {
    const { store, time, calls } = setup({
      maxPendingFollowUps: 2,
      labs: () =>
        Promise.resolve({ data: null, source: "none", fetchedAt: null, respondedAt: "", error: PENDING, partial: [] }),
    });
    store.start();
    await time.advance(60_000);
    assert.equal(calls.labs, 3, "initial request plus two follow-ups");
    assert.equal(store.getState().labs.error?.code, "pending");
    assert.equal(time.pending(), 0);
  });

  it("recovers from pending once the server finishes", async () => {
    let n = 0;
    const { store, time } = setup({
      labs: () => {
        n += 1;
        return Promise.resolve(
          n === 1
            ? { data: null, source: "none" as const, fetchedAt: null, respondedAt: "", error: PENDING, partial: [] }
            : ok({ qbs: ["Maye", "Purdy"] }, time.now()),
        );
      },
    });
    store.start();
    await time.advance(1_000);
    const labs = store.getState().labs;
    assert.equal(labs.error, null);
    assert.deepEqual(labs.data, { qbs: ["Maye", "Purdy"] });
  });

  it("notifies subscribers and stops after unsubscribe", async () => {
    const { store } = setup({});
    let hits = 0;
    const off = store.subscribe(() => (hits += 1));
    await store.refresh("labs");
    assert.equal(hits, 2, "attempt start and response");
    off();
    await store.refresh("labs");
    assert.equal(hits, 2);
  });
});
