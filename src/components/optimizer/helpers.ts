import fantasyFile from "@/data/fantasy.json";
import type { FantasyFile, FantasyPlayer } from "@/data/types";
import type { LineupMode, LineupSelection, PlanIssue } from "@/lib/lineup/selection";
import type { WeekPpr, WeekSkill } from "@/lib/live/types";
import { actualsByPlayer } from "@/lib/match";
import type { SolveFailure, SolverMethod } from "@/lib/optimizer";

const data = fantasyFile as FantasyFile;
export const players = data.players as FantasyPlayer[];
export const playerById = new Map(players.map((p) => [p.id, p]));

export const METHOD: Record<SolverMethod, string> = {
  "exact-dp": "Exact DP",
  "hill-climb": "Hill-climb",
  "greedy-proj": "Proj greedy",
  "greedy-value": "Pts/$ greedy",
};

export const ISSUE_LABEL: Record<PlanIssue["code"], string> = {
  "lock-unscored": "No actual yet",
  "lock-not-on-slate": "Not on this slate",
  "no-actuals": "",
};

export function names(ids: readonly string[]) {
  return ids.map((id) => playerById.get(id)?.name ?? id).join(", ");
}

export function failureText(result: SolveFailure, mode: LineupMode) {
  if (mode === "actual" && (result.status === "infeasible" || result.code === "insufficient-pool"))
    return "Not enough scored players yet for a legal roster with these constraints. Wait for more finals, or switch back to projections.";
  if (result.status === "infeasible")
    return "No feasible lineup with those locks and the salary cap. Unlock someone or raise the cap in your head — this slate is $50k.";
  if (result.status === "invalid-input") return `These constraints can’t make a roster: ${result.message}`;
  return `Solver error (${result.code}): ${result.message}`;
}

/** Players whose actual comes from a week row matching `open`, matched the way the actuals map is. */
export function idsFrom(week: WeekPpr, actuals: ReadonlyMap<string, number>, open: (w: WeekSkill) => boolean) {
  const out = new Set<string>();
  const rows = week.players.filter(open);
  if (rows.length === 0) return out;
  for (const [id, pts] of actualsByPlayer(players, rows)) if (actuals.get(id) === pts) out.add(id);
  return out;
}

export function setupName(s: LineupSelection) {
  return `${s.mode === "actual" ? "Hindsight" : "Projections"} · ${s.locked.length} locked · ${s.excluded.length} benched${s.stack ? " · stack" : ""}`;
}

export function download(filename: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
