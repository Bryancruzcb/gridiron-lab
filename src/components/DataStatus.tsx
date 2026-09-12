import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  FEED_POLICY,
  viewFeed,
  type FeedName,
  type FeedState,
  type SectionSource,
  type SourceKind,
} from "@/lib/live/feed-state";
import type { Scoreboard, SeasonLabs, WeekPpr } from "@/lib/live/types";
import { useSeason } from "@/lib/season-provider";
import { cn } from "@/lib/utils";

/** Wall clock for ages. Null until mounted, so the server render and the first client render match. */
function useNow(intervalMs = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatAge(ms: number): string {
  if (ms < 60_000) return "just now";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const SOURCE_LABEL: Record<SourceKind, string> = { live: "Live", cache: "Cached", snapshot: "Snapshot", none: "No data" };

function RetryButton({ onRetry, busy }: { onRetry?: () => void; busy: boolean }) {
  if (!onRetry) return null;
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={busy}
      className="inline-flex h-7 items-center gap-1 rounded-sm px-2 text-[11px] font-medium tracking-wide text-fg uppercase shadow-[var(--shadow-border)] transition-colors hover:bg-elevated disabled:opacity-50"
    >
      <RotateCw className={cn("size-3", busy && "animate-spin")} aria-hidden />
      {busy ? "Retrying" : "Retry"}
    </button>
  );
}

export type DataStatusProps<T> = {
  /** Stable name for tests and screen readers, e.g. "scoreboard" or "labs-qbs". */
  name: string;
  feed: FeedState<T>;
  freshForMs: number;
  /** Where the data comes from, e.g. "ESPN" or "nflverse". */
  upstream: string;
  /** Provenance of one section of a mixed bundle; overrides the feed's source and time. */
  section?: SectionSource;
  /** Latest game or week the data covers, e.g. "through week 2". Distinct from retrieval time. */
  coverage?: string | null;
  isEmpty?: (data: T) => boolean;
  emptyText?: string;
  unavailableText?: string;
  onRetry?: () => void;
  className?: string;
};

/** Compact source / as-of / stale / partial / retry line for data shown right below it. */
export function DataStatus<T>({
  name,
  feed,
  freshForMs,
  upstream,
  section,
  coverage,
  isEmpty,
  emptyText = "No rows yet.",
  unavailableText,
  onRetry,
  className,
}: DataStatusProps<T>) {
  const now = useNow();
  const view = viewFeed(feed, { nowMs: now, freshForMs, isEmpty, section });

  if (view.kind === "loading") {
    return (
      <p
        role="status"
        data-feed-status={name}
        data-state="loading"
        className={cn("flex items-center gap-2 text-[11px] tracking-[0.14em] text-subtle uppercase", className)}
      >
        <span className="size-1.5 animate-pulse rounded-full bg-subtle" aria-hidden />
        Loading {upstream}
      </p>
    );
  }

  if (view.kind === "unavailable") {
    return (
      <div
        role="status"
        data-feed-status={name}
        data-state="unavailable"
        className={cn("flex flex-wrap items-center justify-between gap-3 rounded-lg bg-rust/10 px-3 py-2.5", className)}
      >
        <div className="min-w-0">
          <p className="text-sm text-rust">{unavailableText ?? `${upstream} data unavailable`}</p>
          {view.error ? <p className="mt-0.5 text-xs text-muted">{view.error.message}</p> : null}
        </div>
        <RetryButton onRetry={onRetry} busy={view.refreshing} />
      </div>
    );
  }

  const stale = view.freshness === "stale";
  const snapshot = view.source === "snapshot";
  const showRetry = Boolean(view.error) || (stale && !snapshot);
  return (
    <div
      role="status"
      data-feed-status={name}
      data-state={view.empty ? "empty" : "ready"}
      data-source={view.source}
      data-freshness={view.freshness}
      className={cn("flex flex-col gap-1", className)}
    >
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tracking-[0.14em] text-subtle uppercase">
        <Badge variant={view.source === "live" ? "sage" : snapshot ? "outline" : "default"}>{SOURCE_LABEL[view.source]}</Badge>
        {stale && !snapshot ? <Badge variant="rust">Stale</Badge> : null}
        <span>{snapshot ? "checked-in file" : upstream}</span>
        {view.asOf && now != null ? (
          <span title={view.asOf}>
            · as of {formatWhen(view.asOf)}
            {view.ageMs != null ? ` (${formatAge(view.ageMs)})` : ""}
          </span>
        ) : null}
        {coverage ? <span>· {coverage}</span> : null}
        {view.refreshing ? <span>· refreshing</span> : null}
        {showRetry ? <RetryButton onRetry={onRetry} busy={view.refreshing} /> : null}
      </p>
      {view.error ? (
        <p className="text-xs text-rust">
          {snapshot ? "Live refresh failed; showing the snapshot. " : "Refresh failed; showing the last good data. "}
          <span className="text-muted">{view.error.message}</span>
        </p>
      ) : null}
      {view.empty ? <p className="text-xs text-muted">{emptyText}</p> : null}
      {view.partial.length > 0 ? (
        <p className="text-xs text-muted">Incomplete: {view.partial.join("; ")}.</p>
      ) : null}
    </div>
  );
}

const labsEmpty = (d: SeasonLabs) => d.qbs.length === 0 && d.teams.length === 0;

/** DataStatus for a provider feed with that feed's defaults. `section` picks a labs section. */
export function FeedStatus({
  feed,
  section = "qbs",
  className,
}: {
  feed: FeedName;
  section?: "qbs" | "teams";
  className?: string;
}) {
  const season = useSeason();
  const retry = () => season.retry(feed);
  if (feed === "labs") {
    const src = season.labsSections[section];
    return (
      <DataStatus<SeasonLabs>
        name={`labs-${section}`}
        feed={season.feeds.labs}
        freshForMs={FEED_POLICY.labs.freshForMs}
        upstream="nflverse"
        section={src}
        coverage={src.throughWeek ? `through week ${src.throughWeek}` : null}
        isEmpty={labsEmpty}
        emptyText="The live 2026 play-by-play file has no rows yet."
        unavailableText="Live 2026 data unavailable"
        onRetry={retry}
        className={className}
      />
    );
  }
  if (feed === "scoreboard") {
    const board = season.feeds.scoreboard.data;
    return (
      <DataStatus<Scoreboard>
        name="scoreboard"
        feed={season.feeds.scoreboard}
        freshForMs={FEED_POLICY.scoreboard.freshForMs}
        upstream="ESPN"
        coverage={board ? `week ${board.week}${board.seasonType === "POST" ? " postseason" : ""}` : null}
        isEmpty={(d) => d.games.length === 0}
        emptyText="No games on this week's board yet."
        unavailableText="Live scores unavailable"
        onRetry={retry}
        className={className}
      />
    );
  }
  const week = season.feeds.weekPpr.data;
  return (
    <DataStatus<WeekPpr>
      name="weekPpr"
      feed={season.feeds.weekPpr}
      freshForMs={FEED_POLICY.weekPpr.freshForMs}
      upstream="ESPN + nflverse"
      coverage={week ? `week ${week.week} · ${week.gamesFinal} final · ${week.gamesLive} live` : null}
      isEmpty={(d) => d.players.length === 0}
      emptyText="No box scores yet this week."
      unavailableText="This week's box scores are unavailable"
      onRetry={retry}
      className={className}
    />
  );
}
