// Current-week merge: provisional ESPN lines plus published nflverse rows for that same week.

import type { WeekSkill } from "../live/types.ts";
import { sameWeek, type PlayerWeek, type WeekKey } from "./player-weeks.ts";
import { isScored, scoreMeta, type Scored } from "./scoring.ts";

export type IdentityKey = (name: string, team: string) => string;

type SkillPos = "QB" | "RB" | "WR" | "TE";
const SKILL: ReadonlySet<string> = new Set(["QB", "RB", "WR", "TE"]);

function skillPos(position: string | null): SkillPos | null {
  return position != null && SKILL.has(position) ? (position as SkillPos) : null;
}

function fromPublished(row: PlayerWeek, pos: SkillPos, score: Scored): WeekSkill {
  const b = row.box;
  return {
    gsisId: row.playerId,
    espnId: row.playerId,
    name: row.name,
    team: row.team,
    pos,
    ppr: score.points,
    headshot: row.headshot,
    status: "post",
    source: "nflverse",
    score: scoreMeta(score),
    passCmp: b.completions,
    passAtt: b.attempts,
    passYds: b.passingYards ?? undefined,
    passTd: b.passingTds ?? undefined,
    ints: b.interceptions ?? undefined,
    rushAtt: b.carries ?? undefined,
    rushYds: b.rushingYards ?? undefined,
    rushTd: b.rushingTds ?? undefined,
    rec: b.receptions ?? undefined,
    recYds: b.receivingYards ?? undefined,
    recTd: b.receivingTds ?? undefined,
  };
}

/**
 * Published rows join only on the scoreboard's full season + season type + week key, so a file
 * that has not reached this week changes nothing and other weeks are never inserted. A final
 * game takes the published score, zero included; a live game keeps its provisional score.
 */
export function mergeCurrentWeek(args: {
  /** null when the scoreboard lacked season, season type or week: live lines only. */
  week: WeekKey | null;
  live: readonly WeekSkill[];
  published: readonly PlayerWeek[];
  identity: IdentityKey;
}): WeekSkill[] {
  const { identity, week } = args;
  const byKey = new Map<string, WeekSkill>();
  for (const line of args.live) {
    const k = identity(line.name, line.team) || line.espnId;
    const prev = byKey.get(k);
    if (!prev || line.ppr >= prev.ppr) byKey.set(k, { ...line });
  }

  if (week) {
    for (const row of args.published) {
      if (!sameWeek(row, week)) continue;
      const k = identity(row.name, row.team) || row.playerId;
      const pos = skillPos(row.position);
      const score = row.score;
      const existing = byKey.get(k);
      if (existing) {
        existing.gsisId = row.playerId;
        if (pos) existing.pos = pos;
        if (existing.status === "post" && isScored(score)) {
          existing.ppr = score.points;
          existing.source = "nflverse";
          existing.score = scoreMeta(score);
        }
      } else if (pos && isScored(score)) {
        byKey.set(k, fromPublished(row, pos, score));
      }
    }
  }
  return [...byKey.values()].sort((a, b) => b.ppr - a.ppr);
}
