import type { FantasyPlayer } from "@/data/types";
import { lastTeamKey, nameTeamKey } from "@/lib/live/names";
import type { WeekSkill } from "@/lib/live/types";

export function actualsByPlayer(players: FantasyPlayer[], week: WeekSkill[]): Map<string, number> {
  const byGsis = new Map<string, WeekSkill>();
  const byName = new Map<string, WeekSkill>();
  const byLast = new Map<string, WeekSkill[]>();
  for (const w of week) {
    if (w.gsisId) byGsis.set(w.gsisId, w);
    byName.set(nameTeamKey(w.name, w.team), w);
    if (w.pos === "DST") byName.set(`dst|${w.team}`, w);
    const lk = lastTeamKey(w.name, w.team);
    const arr = byLast.get(lk) ?? [];
    arr.push(w);
    byLast.set(lk, arr);
  }

  const out = new Map<string, number>();
  for (const p of players) {
    if (p.pos === "DST") {
      const hit = byName.get(`dst|${p.team}`) ?? byName.get(nameTeamKey(p.name, p.team));
      if (hit) out.set(p.id, hit.ppr);
      continue;
    }
    const gsis = byGsis.get(p.id);
    if (gsis) {
      out.set(p.id, gsis.ppr);
      continue;
    }
    const named = byName.get(nameTeamKey(p.name, p.team));
    if (named) {
      out.set(p.id, named.ppr);
      continue;
    }
    const last = byLast.get(lastTeamKey(p.name, p.team));
    if (last?.length === 1) out.set(p.id, last[0]!.ppr);
  }
  return out;
}
