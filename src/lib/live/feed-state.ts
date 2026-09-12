// Client-side state for one live feed, plus provenance for bundles that mix live and snapshot rows.
// Pure: every transition takes the clock as an argument. Timestamps only ever come from the data
// they describe, so a failed request can never make old rows look newly fetched.

import type { FeedError, FeedResponse, SeasonLabs } from "./types.ts";

export type SourceKind = "live" | "cache" | "snapshot" | "none";
export type Freshness = "fresh" | "stale" | "unknown";

export type FeedState<T> = {
  data: T | null;
  sourceKind: SourceKind;
  /** When the rows shown were retrieved upstream. A snapshot keeps the snapshot's own time. */
  dataAsOf: string | null;
  /** Client time of the last response that succeeded. */
  lastSuccessfulFetchAt: string | null;
  lastAttemptAt: string | null;
  isRefreshing: boolean;
  error: FeedError | null;
  /** Incomplete parts of the data shown; empty when complete. */
  partial: string[];
};

export type FeedName = "scoreboard" | "labs" | "weekPpr";

/**
 * serverTtlMs: how long the server serves a cached retrieval without asking upstream.
 * freshForMs: how old data may be before the UI calls it stale. Wider than the server TTL so a
 * normal polling gap never flips a healthy feed to stale.
 */
export const FEED_POLICY = {
  scoreboard: { serverTtlMs: 12_000, freshForMs: 3 * 60_000 },
  detail: { serverTtlMs: 12_000, freshForMs: 3 * 60_000 },
  labs: { serverTtlMs: 20 * 60_000, freshForMs: 45 * 60_000 },
  weekPpr: { serverTtlMs: 2 * 60_000, freshForMs: 10 * 60_000 },
} as const;

export function emptyFeed<T>(): FeedState<T> {
  return {
    data: null,
    sourceKind: "none",
    dataAsOf: null,
    lastSuccessfulFetchAt: null,
    lastAttemptAt: null,
    isRefreshing: false,
    error: null,
    partial: [],
  };
}

export function snapshotFeed<T>(data: T, asOf: string): FeedState<T> {
  return { ...emptyFeed<T>(), data, sourceKind: "snapshot", dataAsOf: asOf };
}

export function startAttempt<T>(state: FeedState<T>, nowIso: string): FeedState<T> {
  return { ...state, isRefreshing: true, lastAttemptAt: nowIso };
}

function time(iso: string | null): number {
  if (iso == null) return Number.NEGATIVE_INFINITY;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Apply a server response. Newer retrievals replace older ones; nothing is stamped with `nowIso` except the success time. */
export function receive<T>(state: FeedState<T>, res: FeedResponse<T>, nowIso: string): FeedState<T> {
  const done = { ...state, isRefreshing: false };
  const carriesData = res.data != null && res.fetchedAt != null;
  const newer = carriesData && (state.data == null || time(res.fetchedAt) >= time(state.dataAsOf));

  if (res.error == null) {
    if (!carriesData) {
      return fail(state, {
        code: "schema",
        message: "The server answered without data or an error",
        retryable: false,
        retryAfterMs: null,
      });
    }
    // Two server instances can hold different caches; never trade newer rows for older ones.
    if (!newer) return { ...done, error: null, lastSuccessfulFetchAt: nowIso };
    return {
      data: res.data,
      sourceKind: res.source === "cache" ? "cache" : "live",
      dataAsOf: res.fetchedAt,
      lastSuccessfulFetchAt: nowIso,
      lastAttemptAt: state.lastAttemptAt ?? nowIso,
      isRefreshing: false,
      error: null,
      partial: res.partial,
    };
  }

  // Failed upstream. The server may still carry its last good retrieval with that retrieval's time.
  if (newer) {
    return { ...done, data: res.data, sourceKind: "cache", dataAsOf: res.fetchedAt, error: res.error, partial: res.partial };
  }
  return { ...done, error: res.error };
}

/** The request itself failed (server unreachable, function threw). Data and its timestamps stay put. */
export function fail<T>(state: FeedState<T>, error: FeedError): FeedState<T> {
  return { ...state, isRefreshing: false, error };
}

export function transportError(err: unknown): FeedError {
  const message = err instanceof Error && err.message ? err.message : "Request failed";
  return { code: "network", message: `Couldn't reach the Gridiron server: ${message}`, retryable: true, retryAfterMs: null };
}

export function ageMs(asOf: string | null, nowMs: number): number | null {
  const t = time(asOf);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, nowMs - t);
}

export function freshnessOf(asOf: string | null, nowMs: number, freshForMs: number): Freshness {
  const age = ageMs(asOf, nowMs);
  if (age == null) return "unknown";
  return age <= freshForMs ? "fresh" : "stale";
}

export type FeedView =
  | { kind: "loading" }
  | { kind: "unavailable"; error: FeedError | null; refreshing: boolean }
  | {
      kind: "data";
      source: SourceKind;
      asOf: string | null;
      freshness: Freshness;
      ageMs: number | null;
      empty: boolean;
      partial: string[];
      refreshing: boolean;
      error: FeedError | null;
    };

/** What the UI should say about a feed. `source`/`asOf` can be overridden by a section's provenance. */
export function viewFeed<T>(
  state: FeedState<T>,
  opts: {
    nowMs: number | null;
    freshForMs: number;
    isEmpty?: (data: T) => boolean;
    section?: SectionSource;
  },
): FeedView {
  if (state.data == null) {
    // After a failure the unavailable state stays up while a retry runs, instead of flickering to loading.
    if (state.error == null && (state.isRefreshing || state.lastAttemptAt == null)) return { kind: "loading" };
    return { kind: "unavailable", error: state.error, refreshing: state.isRefreshing };
  }
  const source = opts.section?.kind ?? state.sourceKind;
  const asOf = opts.section ? opts.section.asOf : state.dataAsOf;
  return {
    kind: "data",
    source,
    asOf,
    freshness: opts.nowMs == null ? "unknown" : freshnessOf(asOf, opts.nowMs, opts.freshForMs),
    ageMs: opts.nowMs == null ? null : ageMs(asOf, opts.nowMs),
    empty: opts.isEmpty ? opts.isEmpty(state.data) : false,
    partial: opts.section && opts.section.kind === "snapshot" ? [] : state.partial,
    refreshing: state.isRefreshing,
    error: state.error,
  };
}

export type SectionSource = { kind: SourceKind; asOf: string | null; throughWeek: number | null };
export type LabsSections = { qbs: SectionSource; teams: SectionSource };

/**
 * One 2026 labs bundle. Each section takes live rows when the live parse has any, else the
 * snapshot's rows with the snapshot's own time and week. Single-week points are never synthesized
 * from season totals: a QB without weekly rows simply has no week strip.
 */
export function mergeLabs(feed: FeedState<SeasonLabs>, snap: SeasonLabs): { labs: SeasonLabs; sections: LabsSections } {
  const live = feed.sourceKind === "live" || feed.sourceKind === "cache" ? feed.data : null;
  const snapSection: SectionSource = { kind: "snapshot", asOf: snap.fetchedAt, throughWeek: snap.throughWeek || null };
  const liveSection: SectionSource | null = live
    ? { kind: feed.sourceKind, asOf: feed.dataAsOf, throughWeek: live.throughWeek || null }
    : null;
  const qbsLive = Boolean(live && live.qbs.length > 0);
  const teamsLive = Boolean(live && live.teams.length > 0);
  const sections: LabsSections = {
    qbs: qbsLive && liveSection ? liveSection : snapSection,
    teams: teamsLive && liveSection ? liveSection : snapSection,
  };
  const oldest = time(sections.qbs.asOf) <= time(sections.teams.asOf) ? sections.qbs.asOf : sections.teams.asOf;
  const source =
    qbsLive === teamsLive
      ? qbsLive && live
        ? live.source
        : snap.source
      : `${qbsLive ? "live" : "snapshot"} QB rows, ${teamsLive ? "live" : "snapshot"} team rows`;
  return {
    labs: {
      season: live?.season || snap.season,
      throughWeek: sections.qbs.throughWeek ?? 0,
      fetchedAt: oldest ?? snap.fetchedAt,
      source,
      qbs: qbsLive && live ? live.qbs : snap.qbs,
      teams: teamsLive && live ? live.teams : snap.teams,
    },
    sections,
  };
}
