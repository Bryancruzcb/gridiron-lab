import snapFile from "@/data/season2026.json";
import type { QbSeason, TeamSeason } from "@/data/types";
import { mergeLabs, snapshotFeed, type FeedState, type LabsSections } from "@/lib/live/feed-state";
import type { SeasonLabs } from "@/lib/live/types";

export const SNAP = snapFile as unknown as SeasonLabs;
export const THIN_N = 30;

export function isThin(n: number) {
  return n > 0 && n < THIN_N;
}

/** The labs feed before any request: the checked-in snapshot, stamped with its own time. */
export function snapshotLabsFeed(snap: SeasonLabs = SNAP): FeedState<SeasonLabs> {
  return snapshotFeed(snap, snap.fetchedAt);
}

/**
 * One 2026 record: each section takes live rows when the live parse has any, else the snapshot's,
 * and says which it used. QBs without observed weekly rows get no week strip (no synthesized week).
 */
export function resolveLabs(
  feed: FeedState<SeasonLabs> | null | undefined,
  snap: SeasonLabs = SNAP,
): { labs: SeasonLabs; sections: LabsSections } {
  return mergeLabs(feed ?? snapshotLabsFeed(snap), snap);
}

export function historyQbs(labs: SeasonLabs, hist: QbSeason[]): QbSeason[] {
  return [...labs.qbs, ...hist.filter((q) => q.season !== 2026)];
}

export function historyTeams(labs: SeasonLabs, hist: TeamSeason[]): TeamSeason[] {
  return [...labs.teams, ...hist.filter((t) => t.season !== 2026)];
}
