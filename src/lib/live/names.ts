import fantasyFile from "@/data/fantasy.json";
import type { FantasyPos } from "@/data/types";

const SUFFIX = /^(jr|sr|ii|iii|iv|v)$/i;

export function normName(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
}

export function lastToken(s: string) {
  const parts = s
    .replace(/\./g, " ")
    .trim()
    .split(/\s+/)
    .filter((p) => p && !SUFFIX.test(p));
  return parts[parts.length - 1] ?? s;
}

export function nameTeamKey(name: string, team: string) {
  return `${normName(name)}|${team}`;
}

export function lastTeamKey(name: string, team: string) {
  return `${normName(lastToken(name))}|${team}`;
}

export type SkillPos = Exclude<FantasyPos, "DST">;

export function seedPosMap(): Map<string, SkillPos> {
  const full = new Map<string, SkillPos>();
  const lastCounts = new Map<string, number>();
  const lastPos = new Map<string, SkillPos>();
  for (const p of fantasyFile.players) {
    if (p.pos === "DST") continue;
    const pos = p.pos as SkillPos;
    full.set(nameTeamKey(p.name, p.team), pos);
    const lk = lastTeamKey(p.name, p.team);
    lastCounts.set(lk, (lastCounts.get(lk) ?? 0) + 1);
    lastPos.set(lk, pos);
  }
  for (const [k, n] of lastCounts) {
    if (n === 1) {
      const pos = lastPos.get(k);
      if (pos) full.set(k, pos);
    }
  }
  return full;
}

export function lookupPos(map: Map<string, SkillPos>, name: string, team: string): SkillPos | null {
  return map.get(nameTeamKey(name, team)) ?? map.get(lastTeamKey(name, team)) ?? null;
}
