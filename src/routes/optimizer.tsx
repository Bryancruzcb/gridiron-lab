import { createFileRoute, Link } from "@tanstack/react-router";
import { memo, useMemo, useState } from "react";
import { Lock, Ban } from "lucide-react";
import fantasyFile from "@/data/fantasy.json";
import { AppShell } from "@/components/layout/AppShell";
import { Headshot } from "@/components/Headshot";
import { FirstLook } from "@/components/FirstLook";
import { StatTip } from "@/components/StatTip";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FantasyFile, FantasyPlayer, FantasyPos } from "@/data/types";
import { slateId, type ImportReport, type LineupMode, type PlanIssue } from "@/lib/lineup/selection";
import { useLineupSolver } from "@/lib/lineup/use-lineup-solver";
import type { WeekPpr } from "@/lib/live/types";
import { actualsByPlayer } from "@/lib/match";
import { teamNick } from "@/lib/nfl";
import { scoreLineup, type SolveFailure, type SolveResult, type SolverMethod } from "@/lib/optimizer";
import { useSeason } from "@/lib/season-provider";
import { cn, formatNum } from "@/lib/utils";

export const Route = createFileRoute("/optimizer")({ component: OptimizerLab });

const data = fantasyFile as FantasyFile;
const players = data.players as FantasyPlayer[];
const playerById = new Map(players.map((p) => [p.id, p]));
const SLATE = slateId(data.season, players, data.cap);
const POS: (FantasyPos | "ALL")[] = ["ALL", "QB", "RB", "WR", "TE", "DST"];

const METHOD: Record<SolverMethod, string> = {
  "exact-dp": "Exact DP",
  "hill-climb": "Hill-climb",
  "greedy-proj": "Proj greedy",
  "greedy-value": "Pts/$ greedy",
};

const ISSUE_LABEL: Record<PlanIssue["code"], string> = {
  "lock-unscored": "No actual yet",
  "lock-not-on-slate": "Not on this slate",
  "no-actuals": "",
};

function names(ids: readonly string[]) {
  return ids.map((id) => playerById.get(id)?.name ?? id).join(", ");
}

function failureText(result: SolveFailure, mode: LineupMode) {
  if (mode === "actual" && (result.status === "infeasible" || result.code === "insufficient-pool"))
    return "Not enough scored players yet for a legal roster with these constraints. Wait for more finals, or switch back to projections.";
  if (result.status === "infeasible")
    return "No feasible lineup with those locks and the salary cap. Unlock someone or raise the cap in your head — this slate is $50k.";
  if (result.status === "invalid-input") return `These constraints can’t make a roster: ${result.message}`;
  return `Solver error (${result.code}): ${result.message}`;
}

/** Players whose actual comes from a game still in progress or a partial box score. */
function notFinalIds(week: WeekPpr, actuals: ReadonlyMap<string, number>) {
  const out = new Set<string>();
  const open = week.players.filter((w) => w.status !== "post" || w.score.status !== "complete");
  if (open.length === 0) return out;
  for (const [id, pts] of actualsByPlayer(players, open)) if (actuals.get(id) === pts) out.add(id);
  return out;
}

function ImportNotice({ report, onDismiss }: { report: ImportReport; onDismiss: () => void }) {
  return (
    <div className={cn("rounded-md p-3 text-sm", report.applied ? "bg-elevated text-muted" : "bg-rust/10 text-rust")}>
      <p className="font-medium">{report.applied ? "Restored your last setup, with a note." : "That lineup setup was not applied."}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        {report.issues.map((issue) => (
          <li key={issue.code + issue.message}>
            {issue.message}
            {issue.ids?.length ? ` ${names(issue.ids)}.` : ""}
          </li>
        ))}
      </ul>
      <button type="button" onClick={onDismiss} className="mt-2 text-xs underline underline-offset-2">
        Dismiss
      </button>
    </div>
  );
}

function BacktestRow({
  label,
  result,
  actuals,
  hindsight = false,
}: {
  label: string;
  result: SolveResult;
  actuals: ReadonlyMap<string, number>;
  hindsight?: boolean;
}) {
  const lineup = result.status === "ok" ? result.lineup : null;
  const score = lineup && !hindsight ? scoreLineup(lineup.players, actuals) : null;
  const title = result.status === "ok" ? `${METHOD[result.method]}, ${result.optimality}` : result.message;
  return (
    <tr className="border-t border-border/70" title={title}>
      <td className="py-1.5">{label}</td>
      <td className={cn("py-1.5 text-right", hindsight && "text-muted")}>{lineup && !hindsight ? lineup.proj.toFixed(1) : "—"}</td>
      <td className="py-1.5 text-right">
        {!lineup ? "—" : hindsight ? lineup.proj.toFixed(1) : `${score!.pts.toFixed(1)}${score!.missing.length ? "*" : ""}`}
      </td>
    </tr>
  );
}

type PlayerRowsProps = {
  rows: FantasyPlayer[];
  lockedIds: ReadonlySet<string>;
  excludedIds: ReadonlySet<string>;
  actuals: ReadonlyMap<string, number> | null;
  notFinal: ReadonlySet<string>;
  mode: LineupMode;
  onLock: (id: string) => void;
  onBench: (id: string) => void;
};

/** Memoized so solve status changes re-render the sidebar, not 114 rows of tooltips. */
const PlayerRows = memo(function PlayerRows({ rows, lockedIds, excludedIds, actuals, notFinal, mode, onLock, onBench }: PlayerRowsProps) {
  return (
    <tbody>
      {rows.map((p) => {
        const isL = lockedIds.has(p.id);
        const isX = excludedIds.has(p.id);
        const val = p.proj / (p.salary / 1000);
        const act = actuals?.get(p.id);
        const lockUnusable = isL && mode === "actual" && act == null;
        return (
          <tr
            key={p.id}
            data-player-id={p.id}
            className={cn(
              "border-b border-border/70",
              isX && "opacity-40",
              isL && "bg-elevated",
            )}
          >
            <td className="px-4 py-2">
              <div className="flex items-center gap-2.5">
                <Headshot src={p.headshot} name={p.name} team={p.team} className="size-8" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-xs text-muted">{teamNick(p.team)}</p>
                </div>
              </div>
            </td>
            <td className="px-2 py-2 text-muted">{p.pos}</td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">{p.proj.toFixed(1)}</td>
            <td
              className={cn(
                "px-2 py-2 text-right font-mono tabular-nums",
                act == null ? "text-subtle" : act >= p.proj ? "text-sage" : "text-muted",
              )}
            >
              {act == null ? "—" : act.toFixed(1)}
              {act != null && notFinal.has(p.id) ? <span className="text-subtle">*</span> : null}
            </td>
            <td className="px-2 py-2 text-right font-mono tabular-nums text-muted">
              ${formatNum(p.salary)}
            </td>
            <td className="px-2 py-2 text-right font-mono tabular-nums text-subtle">
              {val.toFixed(2)}
            </td>
            <td className="px-3 py-2">
              <div className="flex justify-end gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={isL ? "Unlock" : "Lock into lineup"}
                      aria-pressed={isL}
                      onClick={() => onLock(p.id)}
                      className={cn(
                        "grid size-9 place-items-center rounded-sm",
                        lockUnusable
                          ? "bg-rust/20 text-rust"
                          : isL
                            ? "bg-sage/20 text-sage"
                            : "text-subtle hover:bg-elevated hover:text-fg",
                      )}
                    >
                      <Lock className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {lockUnusable
                      ? "Locked, but no actual score yet, so hindsight can’t use him"
                      : isL
                        ? "Locked — always in the lineup"
                        : "Lock: force this player into the lineup"}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={isX ? "Include" : "Bench / exclude"}
                      aria-pressed={isX}
                      onClick={() => onBench(p.id)}
                      className={cn(
                        "grid size-9 place-items-center rounded-sm",
                        isX ? "bg-rust/20 text-rust" : "text-subtle hover:bg-elevated hover:text-fg",
                      )}
                    >
                      <Ban className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isX ? "Benched — tap to put back in the pool" : "Bench: never pick this player"}
                  </TooltipContent>
                </Tooltip>
              </div>
            </td>
          </tr>
        );
      })}
    </tbody>
  );
});

function OptimizerLab() {
  const { weekPpr } = useSeason();
  const [pos, setPos] = useState<(typeof POS)[number]>("ALL");
  const [q, setQ] = useState("");
  const week = weekPpr;

  const actuals = useMemo(() => (week ? actualsByPlayer(players, week.players) : null), [week]);
  const notFinal = useMemo(() => (week && actuals ? notFinalIds(week, actuals) : new Set<string>()), [week, actuals]);
  const solver = useLineupSolver({ players, cap: data.cap, actuals, slate: SLATE });
  const { selection, lineup: lineupView, compare, lineupPlan, importReport } = solver;
  const { mode } = selection;
  const scoredCount = actuals?.size ?? 0;
  const lockedIds = useMemo(() => new Set(selection.locked), [selection.locked]);
  const excludedIds = useMemo(() => new Set(selection.excluded), [selection.excluded]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return players
      .filter((p) => (pos === "ALL" ? true : p.pos === pos))
      .filter((p) => (needle ? p.name.toLowerCase().includes(needle) || p.team.toLowerCase().includes(needle) : true))
      .slice()
      .sort((a, b) => {
        if (mode === "actual") return (actuals?.get(b.id) ?? -1) - (actuals?.get(a.id) ?? -1);
        return b.proj - a.proj;
      });
  }, [pos, q, mode, actuals]);

  const shown = lineupView.current ?? lineupView.outdated;
  const outcome = shown?.outcome ?? null;
  const best = outcome?.best.status === "ok" ? outcome.best : null;
  const lineup = best?.lineup ?? null;
  const isCurrent = lineupView.current !== null;
  const hindsight = outcome?.mode === "actual";
  const bestFailure = lineupView.current && lineupView.current.outcome.best.status !== "ok" ? lineupView.current.outcome.best : null;
  const alt =
    outcome && best && outcome.alternate.status === "ok" && Math.abs(outcome.alternate.lineup.proj - best.lineup.proj) > 0.2
      ? outcome.alternate.lineup
      : null;
  const hasSetup = selection.locked.length > 0 || selection.excluded.length > 0 || selection.stack || mode === "actual";

  const slots = lineup ? lineup.slots : [];
  const usedPct = lineup ? lineup.salary / data.cap : 0;
  const actualScore = lineup && actuals && !hindsight ? scoreLineup(lineup.players, actuals) : null;
  const lineupNotFinal = lineup ? lineup.players.filter((p) => notFinal.has(p.id)).length : 0;
  const leader = week?.players[0];

  const cmpSettled = compare.current ?? compare.outdated;
  const cmp = cmpSettled?.outcome ?? null;
  const cmpMissing =
    cmp && actuals
      ? [cmp.exact, cmp.hillClimb, cmp.greedyValue].some((r) => r.status === "ok" && scoreLineup(r.lineup.players, actuals).missing.length > 0)
      : false;

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="max-w-2xl">
          <h1 className="font-display text-5xl uppercase tracking-[0.03em] sm:text-6xl">Lineup</h1>
        </header>
        <FirstLook id="lineup" title="This page">
          <p>
            Build a $50k roster. Salary is the price. Lock forces a player in; bench keeps him out.
            Hindsight rebuilds on this week’s actual points.
          </p>
        </FirstLook>

        {week && (
          <div className="mt-6 rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[11px] tracking-[0.16em] text-subtle uppercase">
                2026 week {week.week} · {week.gamesFinal} final
                {week.gamesLive ? ` · ${week.gamesLive} live` : ""}
              </p>
              {leader && leader.pos !== "DST" && (
                <p className="text-sm text-muted">
                  {leader.name} leads at{" "}
                  <span className="font-mono text-fg tabular-nums">{leader.ppr.toFixed(1)}</span>
                </p>
              )}
            </div>
          </div>
        )}

        <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_340px]">
          <div className="rounded-xl bg-surface shadow-[var(--shadow-border)]">
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <Segmented
                value={pos}
                onChange={setPos}
                options={POS.map((p) => ({ value: p, label: p === "ALL" ? "All" : p }))}
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search player or team"
                className="sm:max-w-[220px]"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
                  <tr className="border-y border-border">
                    <th className="px-4 py-2 font-medium">Player</th>
                    <th className="px-2 py-2 font-medium">Pos</th>
                    <th className="px-2 py-2 text-right font-medium">
                      <StatTip metric="proj" />
                    </th>
                    <th className="px-2 py-2 text-right font-medium">
                      <StatTip metric="actual" />
                    </th>
                    <th className="px-2 py-2 text-right font-medium">
                      <StatTip metric="salary" />
                    </th>
                    <th className="px-2 py-2 text-right font-medium">
                      <StatTip metric="val" />
                    </th>
                    <th className="px-3 py-2 text-right font-medium">
                      <span className="text-[10px] tracking-wide text-subtle uppercase">Lock / bench</span>
                    </th>
                  </tr>
                </thead>
                <PlayerRows
                  rows={filtered}
                  lockedIds={lockedIds}
                  excludedIds={excludedIds}
                  actuals={actuals}
                  notFinal={notFinal}
                  mode={mode}
                  onLock={solver.toggleLock}
                  onBench={solver.toggleExclude}
                />
              </table>
            </div>
          </div>

          <aside className="flex flex-col gap-4">
            <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
              <p className="text-[11px] tracking-[0.16em] text-subtle uppercase">Solve</p>
              <label className="mt-4 flex items-center gap-3 text-sm">
                <Checkbox checked={selection.stack} onCheckedChange={(v) => solver.setStack(v === true)} />
                Stack QB with a WR/TE
              </label>
              <label className="mt-3 flex items-center gap-3 text-sm">
                <Checkbox
                  checked={mode === "actual"}
                  onCheckedChange={(v) => solver.setMode(v === true ? "actual" : "proj")}
                  disabled={mode !== "actual" && (!week || scoredCount < 9)}
                />
                Solve on this week’s actuals
              </label>
              <p className="mt-2 text-xs text-subtle" data-testid="selection-counts">
                {selection.locked.length} locked · {selection.excluded.length} excluded
                {week ? ` · ${scoredCount} scored` : ""}
              </p>
              <div className="mt-5 flex gap-2">
                <Button className="flex-1" onClick={solver.run} disabled={lineupView.running || !lineupPlan.ok}>
                  {lineupView.running ? "Solving…" : mode === "actual" ? "Hindsight lineup" : "Build lineup"}
                </Button>
                {lineupView.running && (
                  <Button variant="secondary" onClick={solver.cancel}>
                    Cancel
                  </Button>
                )}
              </div>
              {hasSetup && (
                <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={solver.reset}>
                  Reset
                </Button>
              )}
              <div className="mt-3 space-y-2 text-sm" data-testid="solve-status" aria-live="polite">
                {importReport && <ImportNotice report={importReport} onDismiss={solver.dismissImport} />}
                {!lineupPlan.ok &&
                  lineupPlan.issues.map((issue) => (
                    <p key={issue.code} className="text-rust" data-issue={issue.code}>
                      {issue.message}
                      {issue.ids.length ? (
                        <span className="mt-0.5 block text-xs">
                          {ISSUE_LABEL[issue.code]}: {names(issue.ids)}
                        </span>
                      ) : null}
                    </p>
                  ))}
                {lineupView.running && <p className="text-muted">Solving in the background. Cancel stops it.</p>}
                {lineupView.failure && (
                  <div className="text-rust" data-failure={lineupView.failure.code}>
                    <p>{lineupView.failure.message} Nothing was solved on the page instead.</p>
                    <Button variant="secondary" size="sm" className="mt-2" onClick={solver.run} disabled={!lineupPlan.ok}>
                      Retry
                    </Button>
                  </div>
                )}
                {!lineupView.running && lineupView.cancelled && (
                  <p className="text-muted">Cancelled. Nothing was solved for this setup.</p>
                )}
                {bestFailure && (
                  <p className="text-rust" data-solve-status={bestFailure.status}>
                    {failureText(bestFailure, mode)}
                  </p>
                )}
                {!lineupView.running && lineupPlan.ok && lineup && !isCurrent && !lineupView.cancelled && !lineupView.failure && (
                  <p className="text-muted">
                    Setup changed since this lineup was built. {mode === "actual" ? "Hindsight lineup" : "Build lineup"} to update it.
                  </p>
                )}
              </div>
            </div>

            {lineup && best && shown && outcome && (
              <div
                data-testid="lineup-result"
                data-current={String(isCurrent)}
                data-mode={outcome.mode}
                data-method={best.method}
                data-optimality={best.optimality}
                data-fingerprint={shown.fingerprint}
                data-request-id={shown.requestId}
                data-elapsed-ms={Math.round(shown.elapsedMs)}
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
                  ${formatNum(lineup.salary)} / ${formatNum(data.cap)} · ${formatNum(lineup.remaining)} left
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
              </div>
            )}

            {alt && (
              <div className={cn("rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]", !isCurrent && "opacity-60")}>
                <h2 className="font-display text-lg uppercase tracking-[0.06em]">Value greedy</h2>
                <p className="mt-2 font-mono text-sm">{alt.proj.toFixed(1)} pts</p>
                <p className="mt-1 text-xs text-muted">Pts/$ greedy on the same constraints · heuristic</p>
              </div>
            )}

            {actuals && actuals.size > 0 && (
              <div
                data-testid="backtest"
                data-current={String(compare.current !== null)}
                className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]"
              >
                <h2 className="font-display text-lg uppercase tracking-[0.06em]">Backtest</h2>
                <p className="mt-1 text-xs text-muted">
                  Whole slate, no locks. Solved on projections, scored on this week’s actuals.
                </p>
                {compare.running && <p className="mt-3 text-sm text-muted">Comparing…</p>}
                {compare.failure && (
                  <p className="mt-3 text-sm text-rust">
                    {compare.failure.message}{" "}
                    <button type="button" onClick={solver.retryCompare} className="underline underline-offset-2">
                      Retry
                    </button>
                  </p>
                )}
                {cmp && (
                  <table className={cn("mt-3 w-full text-left text-sm", !compare.current && "opacity-60")}>
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
                    {notFinal.size ? ` ${notFinal.size} scores are not final.` : ""}
                  </p>
                )}
                <p className="mt-3 text-xs text-muted">
                  <Link to="/study" className="text-fg">
                    2025 weeks 2–18
                  </Link>
                </p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
