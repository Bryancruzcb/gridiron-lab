import { Lock, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { FantasyPlayer } from "@/data/types";
import type { LineupMode } from "@/lib/lineup/selection";
import type { SolveResult } from "@/lib/optimizer";
import { cn, formatNum } from "@/lib/utils";
import { METHOD } from "./helpers";

type Slot = { slot: string; player: FantasyPlayer };
type Best = Extract<SolveResult, { status: "ok" }>;

type Props = {
  isCurrent: boolean;
  hindsight: boolean;
  best: Best;
  shown: { fingerprint: string; requestId: string; elapsedMs: number };
  outcome: { mode: LineupMode };
  lineup: { proj: number; salary: number; remaining: number; players: FantasyPlayer[]; slots: Slot[] };
  usedPct: number;
  cap: number;
  slate: string;
  actualsV: string | null;
  actualScore: { pts: number; n: number } | null;
  lineupNotFinal: number;
  lockedIds: ReadonlySet<string>;
  actuals: ReadonlyMap<string, number> | null;
  exportResult: (format: "json" | "csv") => void;
};

/** Sidebar card showing the current (or outdated) solved lineup. */
export function LineupResult({
  isCurrent,
  hindsight,
  best,
  shown,
  outcome,
  lineup,
  usedPct,
  cap,
  slate,
  actualsV,
  actualScore,
  lineupNotFinal,
  lockedIds,
  actuals,
  exportResult,
}: Props) {
  const slots = lineup.slots;
  return (
    <div
      data-testid="lineup-result"
      data-current={String(isCurrent)}
      data-mode={outcome.mode}
      data-method={best.method}
      data-optimality={best.optimality}
      data-fingerprint={shown.fingerprint}
      data-request-id={shown.requestId}
      data-elapsed-ms={Math.round(shown.elapsedMs)}
      data-slate={slate}
      data-actuals-version={actualsV ?? ""}
      className={cn("rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]", !isCurrent && "opacity-60")}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-xl uppercase tracking-[0.06em]">
          {hindsight ? "Hindsight" : best.optimality === "proven" ? "Optimal" : "Best found"}
        </h2>
        <div className="flex items-center gap-1.5">
          {!isCurrent && <Badge variant="outline">Outdated</Badge>}
          <Badge variant="sage">{lineup.proj.toFixed(1)} pts</Badge>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted">
        {METHOD[best.method]} ·{" "}
        {best.optimality === "proven" ? "proven optimal for these constraints" : "heuristic, not proven optimal"}
        {best.fallbackReason ? `. ${best.fallbackReason}` : ""}
      </p>
      {hindsight && (
        <p className="mt-1 text-xs text-muted">
          A retrospective upper bound on this week’s actual points with these constraints, not a forecast.
          {lineupNotFinal ? ` ${lineupNotFinal} of these scores are not final.` : ""}
        </p>
      )}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-elevated">
        <div className="h-full bg-accent" style={{ width: `${Math.min(100, usedPct * 100)}%` }} />
      </div>
      <p className="mt-2 font-mono text-xs text-muted">
        ${formatNum(lineup.salary)} / ${formatNum(cap)} · ${formatNum(lineup.remaining)} left
      </p>
      {actualScore && (
        <p className="mt-1 font-mono text-xs text-sage">
          {actualScore.pts.toFixed(1)} actual · {actualScore.n}/{lineup.players.length} scored
          {lineupNotFinal ? ` · ${lineupNotFinal} not final` : ""}
        </p>
      )}
      <ul className="mt-4 divide-y divide-border">
        {slots.map(({ slot, player }) => {
          const act = actuals?.get(player.id);
          return (
            <li key={player.id} data-player-id={player.id} className="flex items-center justify-between gap-2 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="w-8 font-mono text-[10px] text-subtle">{slot}</span>
                <span className="truncate text-sm">{player.name}</span>
                {lockedIds.has(player.id) && <Lock className="size-3 shrink-0 text-sage" aria-label="Locked" />}
              </div>
              <span className="font-mono text-xs tabular-nums text-muted">
                {player.proj.toFixed(1)}
                {act != null && !hindsight ? <span className="ml-2 text-sage">{act.toFixed(1)}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
      {isCurrent && (
        <div className="mt-4 border-t border-border pt-3">
          <p data-testid="input-version" className="font-mono text-[10px] break-all text-subtle">
            Input · slate {slate} · {actualsV ? `week scores ${actualsV}` : "no week scores loaded"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => exportResult("json")}>
              <Download aria-hidden />
              Export JSON
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => exportResult("csv")}>
              <Download aria-hidden />
              Export CSV
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">
            An export keeps this exact lineup, its scores and the input version above, to inspect later. The setup link
            recomputes instead.
          </p>
        </div>
      )}
    </div>
  );
}
