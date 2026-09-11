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
    Promise.all([getSeasonLabs().catch(() => null), getWeekPpr().catch(() => null)]).then(
      ([labs, week]) => {
        if (cancelled) return;
        setLive(labs);
        setWeekPpr(week);
        setReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const labs = useMemo(() => resolveLabs(live), [live]);
  const value = useMemo(() => ({ labs, weekPpr, ready }), [labs, weekPpr, ready]);
  return <SeasonContext.Provider value={value}>{children}</SeasonContext.Provider>;
}

export function useSeason(): SeasonState {
  return useContext(SeasonContext) ?? { labs: resolveLabs(null), weekPpr: null, ready: false };
}
