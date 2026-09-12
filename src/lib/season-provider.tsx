import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getScoreboard, getSeasonLabs, getWeekPpr } from "@/lib/live/functions";
import type { Scoreboard, SeasonLabs, WeekPpr } from "@/lib/live/types";
import { resolveLabs } from "@/lib/season";

export type SeasonState = {
  labs: SeasonLabs;
  weekPpr: WeekPpr | null;
  scoreboard: Scoreboard | null;
  ready: boolean;
};

const SeasonContext = createContext<SeasonState | null>(null);

export function SeasonProvider({ children }: { children: ReactNode }) {
  const [live, setLive] = useState<SeasonLabs | null>(null);
  const [weekPpr, setWeekPpr] = useState<WeekPpr | null>(null);
  const [scoreboard, setScoreboard] = useState<Scoreboard | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getScoreboard()
      .catch(() => null)
      .then((b) => {
        if (!cancelled && b) setScoreboard(b);
      });
    getSeasonLabs()
      .catch(() => null)
      .then((labs) => {
        if (!cancelled && labs) setLive(labs);
        if (!cancelled) setReady(true);
      });
    const idle = window.setTimeout(() => {
      getWeekPpr()
        .catch(() => null)
        .then((week) => {
          if (!cancelled && week) setWeekPpr(week);
        });
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(idle);
    };
  }, []);

  const labs = useMemo(() => resolveLabs(live), [live]);
  const value = useMemo(
    () => ({ labs, weekPpr, scoreboard, ready }),
    [labs, weekPpr, scoreboard, ready],
  );
  return <SeasonContext.Provider value={value}>{children}</SeasonContext.Provider>;
}

export function useSeason(): SeasonState {
  return (
    useContext(SeasonContext) ?? {
      labs: resolveLabs(null),
      weekPpr: null,
      scoreboard: null,
      ready: false,
    }
  );
}
