import { Link } from "@tanstack/react-router";
import type { SolveResult } from "@/lib/optimizer";
import { cn } from "@/lib/utils";
import { BacktestRow } from "./BacktestRow";

type CompareOutcome = {
  exact: SolveResult;
  hillClimb: SolveResult;
  greedyValue: SolveResult;
  hindsight: SolveResult;
};

type Props = {
  compareCurrent: boolean;
  compareRunning: boolean;
  compareFailure: { message: string } | null;
  cmp: CompareOutcome | null;
  actuals: ReadonlyMap<string, number>;
  cmpMissing: boolean;
  notFinalSize: number;
  retryCompare: () => void;
};

/** Sidebar backtest table: Exact DP / Hill-climb / Pts/$ / Hindsight on this week's actuals. */
export function BacktestPanel({
  compareCurrent,
  compareRunning,
  compareFailure,
  cmp,
  actuals,
  cmpMissing,
  notFinalSize,
  retryCompare,
}: Props) {
  return (
    <div
      data-testid="backtest"
      data-current={String(compareCurrent)}
      className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]"
    >
      <h2 className="font-display text-lg uppercase tracking-[0.06em]">Backtest</h2>
      <p className="mt-1 text-xs text-muted">
        Whole slate, no locks. Solved on projections, scored on this week's actuals.
      </p>
      {compareRunning && <p className="mt-3 text-sm text-muted">Comparing…</p>}
      {compareFailure && (
        <p className="mt-3 text-sm text-rust">
          {compareFailure.message}{" "}
          <button type="button" onClick={retryCompare} className="underline underline-offset-2">
            Retry
          </button>
        </p>
      )}
      {cmp && (
        <table className={cn("mt-3 w-full text-left text-sm", !compareCurrent && "opacity-60")}>
          <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
            <tr>
              <th className="py-1 font-medium"> </th>
              <th className="py-1 text-right font-medium">Proj</th>
              <th className="py-1 text-right font-medium">Actual</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            <BacktestRow label="Exact DP" result={cmp.exact} actuals={actuals} />
            <BacktestRow label="Hill-climb" result={cmp.hillClimb} actuals={actuals} />
            <BacktestRow label="Pts/$ greedy" result={cmp.greedyValue} actuals={actuals} />
            <BacktestRow label="Hindsight" result={cmp.hindsight} actuals={actuals} hindsight />
          </tbody>
        </table>
      )}
      {cmp && (
        <p className="mt-3 text-xs text-muted">
          Hindsight is the best lineup in retrospect: an upper bound, not a forecast.
          {cmpMissing ? " * Some players have no actual yet; they count as missing, not zero." : ""}
          {notFinalSize ? ` ${notFinalSize} scores are not final.` : ""}
        </p>
      )}
      <p className="mt-3 text-xs text-muted">
        <Link to="/study" className="text-fg">
          Study: 2023–2025, weeks 2–18
        </Link>
      </p>
    </div>
  );
}
