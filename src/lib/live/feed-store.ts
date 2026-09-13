// Client store for independent live feeds: deduplicated refresh, one shared polling timer per feed,
// bounded follow-ups while the server reports a load still running. Framework-free; the React
// provider subscribes to it. Clock and timers are injected so tests run on fake time.

import { receive, fail, startAttempt, transportError, type FeedState } from "./feed-state.ts";
import { realTimers, type Timers } from "./loader.ts";
import type { FeedResponse } from "./types.ts";

export type FeedsOf<M> = { [K in keyof M]: FeedState<M[K]> };

export type FeedStoreOptions<M> = {
  fetchers: { [K in keyof M]: () => Promise<FeedResponse<M[K]>> };
  initial: FeedsOf<M>;
  now?: () => number;
  timers?: Timers;
  /** Polls skip their fetch while this returns false (hidden tab). */
  isActive?: () => boolean;
  /** Follow-ups after a "pending" answer before waiting for a poll or a manual retry. */
  maxPendingFollowUps?: number;
};

export type FeedStore<M> = {
  getState(): FeedsOf<M>;
  subscribe(listener: () => void): () => void;
  /** Joins the running request for this feed if there is one. Never rejects. */
  refresh(name: keyof M): Promise<void>;
  /** Poll while the lease is held; the shortest held interval wins. Returns the release. */
  poll(name: keyof M, intervalMs: number): () => void;
  /** Initial load: feeds without a delay start now, the rest after their delay. Returns stop. */
  start(delays?: Partial<Record<keyof M, number>>): () => void;
};

export function createFeedStore<M>(opts: FeedStoreOptions<M>): FeedStore<M> {
  const now = opts.now ?? Date.now;
  const timers = opts.timers ?? realTimers;
  const isActive = opts.isActive ?? (() => true);
  const maxFollowUps = opts.maxPendingFollowUps ?? 4;
  const names = Object.keys(opts.fetchers) as (keyof M)[];

  let state = opts.initial;
  let running = false;
  const listeners = new Set<() => void>();
  const inflight = new Map<keyof M, Promise<void>>();
  const leases = new Map<keyof M, Set<{ ms: number }>>();
  const pollTimers = new Map<keyof M, unknown>();
  const followUpTimers = new Map<keyof M, unknown>();
  const startTimers = new Set<unknown>();
  const followUps = new Map<keyof M, number>();
  const settledAt = new Map<keyof M, number>();
  const iso = () => new Date(now()).toISOString();

  function update<K extends keyof M>(name: K, fn: (s: FeedState<M[K]>) => FeedState<M[K]>) {
    state = { ...state, [name]: fn(state[name]) };
    for (const l of listeners) l();
  }

  function clearTimer(map: Map<keyof M, unknown>, name: keyof M) {
    const id = map.get(name);
    if (id !== undefined) timers.clearTimeout(id);
    map.delete(name);
  }

  function schedulePoll(name: keyof M, skipDue = false) {
    clearTimer(pollTimers, name);
    const held = leases.get(name);
    if (!running || !held || held.size === 0 || inflight.has(name)) return;
    const interval = Math.min(...[...held].map((l) => l.ms));
    const last = state[name].lastAttemptAt ? Date.parse(state[name].lastAttemptAt!) : Number.NEGATIVE_INFINITY;
    // Start-to-start interval, but a slow request still leaves a third of the interval before the next.
    const gapAfterSettle = (settledAt.get(name) ?? Number.NEGATIVE_INFINITY) + interval / 3;
    const due = skipDue ? interval : Math.max(0, Math.min(interval, Math.max(last + interval, gapAfterSettle) - now()));
    pollTimers.set(
      name,
      timers.setTimeout(() => {
        pollTimers.delete(name);
        if (isActive()) void refresh(name);
        else schedulePoll(name, true);
      }, due),
    );
  }

  function afterSettle(name: keyof M) {
    const error = state[name].error;
    clearTimer(followUpTimers, name);
    if (error?.code === "pending" && running) {
      const n = (followUps.get(name) ?? 0) + 1;
      followUps.set(name, n);
      if (n <= maxFollowUps) {
        followUpTimers.set(
          name,
          timers.setTimeout(() => {
            followUpTimers.delete(name);
            void refresh(name);
          }, error.retryAfterMs ?? 4_000),
        );
      }
    } else if (error?.code !== "pending") {
      followUps.delete(name);
    }
    schedulePoll(name);
  }

  function refresh(name: keyof M): Promise<void> {
    const existing = inflight.get(name);
    if (existing) return existing;
    clearTimer(pollTimers, name);
    update(name, (s) => startAttempt(s, iso()));
    let request: Promise<FeedResponse<M[keyof M]>>;
    try {
      request = Promise.resolve(opts.fetchers[name]());
    } catch (err) {
      request = Promise.reject(err);
    }
    const p = request
      .then(
        (res) => update(name, (s) => receive(s, res, iso())),
        (err) => update(name, (s) => fail(s, transportError(err))),
      )
      .finally(() => {
        inflight.delete(name);
        settledAt.set(name, now());
        afterSettle(name);
      });
    inflight.set(name, p);
    return p;
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    poll(name, intervalMs) {
      const lease = { ms: intervalMs };
      const held = leases.get(name) ?? new Set();
      held.add(lease);
      leases.set(name, held);
      schedulePoll(name);
      return () => {
        held.delete(lease);
        schedulePoll(name);
      };
    },
    start(delays = {}) {
      running = true;
      for (const name of names) {
        const delay = delays[name];
        if (state[name].lastAttemptAt != null && !state[name].error) {
          schedulePoll(name);
          continue;
        }
        if (delay == null) {
          void refresh(name);
          continue;
        }
        const id = timers.setTimeout(() => {
          startTimers.delete(id);
          void refresh(name);
        }, delay);
        startTimers.add(id);
      }
      return () => {
        running = false;
        for (const id of startTimers) timers.clearTimeout(id);
        startTimers.clear();
        for (const name of names) {
          clearTimer(pollTimers, name);
          clearTimer(followUpTimers, name);
        }
      };
    },
  };
}
