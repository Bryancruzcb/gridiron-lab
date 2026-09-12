import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { getScoreboard, getSeasonLabs, getWeekPpr } from "@/lib/live/functions";
import { emptyFeed, type FeedName, type LabsSections } from "@/lib/live/feed-state";
import { createFeedStore, type FeedsOf, type FeedStore } from "@/lib/live/feed-store";
import type { Scoreboard, SeasonLabs, WeekPpr } from "@/lib/live/types";
import { resolveLabs, snapshotLabsFeed } from "@/lib/season";

export type SeasonFeeds = { scoreboard: Scoreboard; labs: SeasonLabs; weekPpr: WeekPpr };

export type SeasonState = {
  /** 2026 labs: live rows where the live parse has them, snapshot rows elsewhere. */
  labs: SeasonLabs;
  /** Where each labs section came from, with that source's own time and week. */
  labsSections: LabsSections;
  weekPpr: WeekPpr | null;
  scoreboard: Scoreboard | null;
  /** The first labs request has settled, successfully or not. */
  ready: boolean;
  /** Per-feed source, timestamps, refresh activity and errors. */
  feeds: FeedsOf<SeasonFeeds>;
  /** Refetch one feed. Joins a request already running and keeps current data meanwhile. */
  retry: (feed: FeedName) => void;
  /** Poll a feed while held; every holder shares one timer. Returns the release. */
  poll: (feed: FeedName, intervalMs: number) => () => void;
};

const WEEK_PPR_DELAY_MS = 1500;

function initialFeeds(): FeedsOf<SeasonFeeds> {
  return { scoreboard: emptyFeed(), labs: snapshotLabsFeed(), weekPpr: emptyFeed() };
}

const SeasonContext = createContext<SeasonState | null>(null);

function useSeasonValue(feeds: FeedsOf<SeasonFeeds>, store: FeedStore<SeasonFeeds> | null): SeasonState {
  const { data: labsData, sourceKind: labsKind, dataAsOf: labsAsOf } = feeds.labs;
  // Only a change in rows or provenance rebuilds the bundle, so refresh flags don't churn consumers.
  const resolved = useMemo(
    () => resolveLabs({ ...emptyFeed<SeasonLabs>(), data: labsData, sourceKind: labsKind, dataAsOf: labsAsOf }),
    [labsData, labsKind, labsAsOf],
  );
  const actions = useMemo(
    () => ({
      retry: (feed: FeedName) => void store?.refresh(feed),
      poll: (feed: FeedName, intervalMs: number) => store?.poll(feed, intervalMs) ?? (() => {}),
    }),
    [store],
  );
  return useMemo(
    () => ({
      labs: resolved.labs,
      labsSections: resolved.sections,
      weekPpr: feeds.weekPpr.data,
      scoreboard: feeds.scoreboard.data,
      ready: feeds.labs.lastAttemptAt != null && !feeds.labs.isRefreshing,
      feeds,
      ...actions,
    }),
    [resolved, feeds, actions],
  );
}

export function SeasonProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() =>
    createFeedStore<SeasonFeeds>({
      initial: initialFeeds(),
      fetchers: {
        scoreboard: () => getScoreboard(),
        labs: () => getSeasonLabs(),
        weekPpr: () => getWeekPpr(),
      },
      isActive: () => typeof document === "undefined" || document.visibilityState !== "hidden",
    }),
  );
  const feeds = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  useEffect(() => store.start({ weekPpr: WEEK_PPR_DELAY_MS }), [store]);
  const value = useSeasonValue(feeds, store);
  return <SeasonContext.Provider value={value}>{children}</SeasonContext.Provider>;
}

const OUTSIDE_PROVIDER = initialFeeds();

export function useSeason(): SeasonState {
  const fromProvider = useContext(SeasonContext);
  const fallback = useSeasonValue(OUTSIDE_PROVIDER, null);
  return fromProvider ?? fallback;
}

/** Keep `feed` polled every `intervalMs` while mounted; null pauses. Shares the provider's timer. */
export function useFeedPoll(feed: FeedName, intervalMs: number | null) {
  const { poll } = useSeason();
  useEffect(() => (intervalMs == null ? undefined : poll(feed, intervalMs)), [poll, feed, intervalMs]);
}
