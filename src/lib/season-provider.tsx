import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSeasonLabs, getWeekPpr } from "@/lib/live/functions";
import type { SeasonLabs, WeekPpr } from "@/lib/live/types";
import { resolveLabs } from "@/lib/season";

export type SeasonState = {
  labs: SeasonLabs;
  weekPpr: WeekPpr | null;
  ready: boolean;
};

const SeasonContext = createContext<SeasonState | null>(null);

export function SeasonProvider({ children }: { children: ReactNode }) {
  const [live, setLive] = useState<SeasonLabs | null>(null);
  const [weekPpr, setWeekPpr] = useState<WeekPpr | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
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
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(idle);
    };
  }, []);

  const labs = useMemo(() => resolveLabs(live), [live]);
  const value = useMemo(() => ({ labs, weekPpr, ready }), [labs, weekPpr, ready]);
  return <SeasonContext.Provider value={value}>{children}</SeasonContext.Provider>;
}

export function useSeason(): SeasonState {
  return useContext(SeasonContext) ?? { labs: resolveLabs(null), weekPpr: null, ready: false };
}
