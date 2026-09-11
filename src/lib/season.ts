import snapFile from "@/data/season2026.json";
import type { QbSeason, TeamSeason } from "@/data/types";
import type { SeasonLabs } from "@/lib/live/types";

export const SNAP = snapFile as unknown as SeasonLabs;
export const THIN_N = 30;

export function isThin(n: number) {
  return n > 0 && n < THIN_N;
}

/** One 2026 record: live parse if a side has rows, else the snapshot. */
export function resolveLabs(live: SeasonLabs | null | undefined, snap: SeasonLabs = SNAP): SeasonLabs {
  if (!live) return withWeekFallback(snap);
  const qbs = live.qbs.length ? live.qbs : snap.qbs;
  const teams = live.teams.length ? live.teams : snap.teams;
  const usedLive = live.qbs.length > 0 || live.teams.length > 0;
  return withWeekFallback({
    season: live.season || snap.season,
    throughWeek: live.throughWeek || snap.throughWeek,
    fetchedAt: live.fetchedAt || snap.fetchedAt,
    source: usedLive ? live.source : snap.source,
    qbs,
    teams,
  });
}

export function withWeekFallback(labs: SeasonLabs): SeasonLabs {
  const week = labs.throughWeek || 1;
  return {
    ...labs,
    qbs: labs.qbs.map((q) => {
      if (q.weeks?.length) return q;
      return {
        ...q,
        weeks: [
          {
            week,
            plays: q.overall.plays,
            epa: q.overall.epa,
            cpoe: q.overall.cpoe,
          },
        ],
      };
    }),
  };
}

export function historyQbs(labs: SeasonLabs, hist: QbSeason[]): QbSeason[] {
  return [...labs.qbs, ...hist.filter((q) => q.season !== 2026)];
}

export function historyTeams(labs: SeasonLabs, hist: TeamSeason[]): TeamSeason[] {
  return [...labs.teams, ...hist.filter((t) => t.season !== 2026)];
}
