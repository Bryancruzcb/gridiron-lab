import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { actualsByPlayer } from "@/lib/match";
import { teamNick } from "@/lib/nfl";
import { exactLineup, greedyLineup, hillClimbLineup, optimizeLineup, orderedLineup, scoreLineup, type Lineup } from "@/lib/optimizer";
import { useSeason } from "@/lib/season-provider";
import { cn, formatNum } from "@/lib/utils";

export const Route = createFileRoute("/optimizer")({ component: OptimizerLab });

const data = fantasyFile as FantasyFile;
const POS: (FantasyPos | "ALL")[] = ["ALL", "QB", "RB", "WR", "TE", "DST"];

function OptimizerLab() {
  const { weekPpr } = useSeason();
  const [pos, setPos] = useState<(typeof POS)[number]>("ALL");
  const [q, setQ] = useState("");
  const [locked, setLocked] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [stack, setStack] = useState(false);
  const [mode, setMode] = useState<"proj" | "actual">("proj");
  const week = weekPpr;
  const players = data.players as FantasyPlayer[];

  const actuals = useMemo(() => (week ? actualsByPlayer(players, week.players) : new Map<string, number>()), [week, players]);

  const backtest = useMemo(() => {
    if (actuals.size < 1) return null;
    const empty = { locked: new Set<string>(), excluded: new Set<string>() };
    const exact = exactLineup({ players, cap: data.cap, ...empty });
    const hill = hillClimbLineup({ players, cap: data.cap, ...empty });
    const value = greedyLineup({ players, cap: data.cap, ...empty, by: "value" });
    const scored = players.filter((p) => actuals.has(p.id)).map((p) => ({ ...p, proj: actuals.get(p.id) ?? 0 }));
    const hindsight = exactLineup({ players: scored, cap: data.cap, ...empty })
      ?? optimizeLineup({ players: scored, cap: data.cap, ...empty });
    return {
      exact: { proj: exact?.proj ?? 0, actual: scoreLineup(exact?.players ?? [], actuals) },
      hill: { proj: hill?.proj ?? 0, actual: scoreLineup(hill?.players ?? [], actuals) },
      value: { proj: value?.proj ?? 0, actual: scoreLineup(value?.players ?? [], actuals) },
      hindsight: hindsight?.proj ?? 0,
    };
  }, [players, actuals]);

  const slate = useMemo(() => {
    if (mode !== "actual") return players;
    return players
      .filter((p) => actuals.has(p.id))
      .map((p) => ({ ...p, proj: actuals.get(p.id) ?? 0 }));
  }, [players, mode, actuals]);

  const [lineup, setLineup] = useState<Lineup | null>(null);
  const [alt, setAlt] = useState<Lineup | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const best = optimizeLineup({
      players: slate,
      cap: data.cap,
      locked: new Set(),
      excluded: new Set(),
    });
    setLineup(best);
    setAlt(null);
  }, [slate]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return players
      .filter((p) => (pos === "ALL" ? true : p.pos === pos))
      .filter((p) => (needle ? p.name.toLowerCase().includes(needle) || p.team.toLowerCase().includes(needle) : true))
      .slice()
      .sort((a, b) => {
        if (mode === "actual") return (actuals.get(b.id) ?? -1) - (actuals.get(a.id) ?? -1);
        return b.proj - a.proj;
      });
  }, [players, pos, q, mode, actuals]);

  const toggle = (list: string[], id: string, set: (v: string[]) => void) => {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const run = () => {
    setBusy(true);
    setError(null);
    window.setTimeout(() => {
      const lockedSet = new Set(locked);
      const excludedSet = new Set(excluded);
      const best = optimizeLineup({
        players: slate,
        cap: data.cap,
        locked: lockedSet,
        excluded: excludedSet,
        requireStack: stack,
      });
      const value = greedyLineup({
        players: slate,
        cap: data.cap,
        locked: lockedSet,
        excluded: excludedSet,
      });
      setLineup(best);
      setAlt(value && best && Math.abs(value.proj - best.proj) > 0.2 ? value : null);
      if (!best)
        setError(
          mode === "actual"
            ? "Not enough scored players yet for a legal roster. Wait for more finals, or switch back to projections."
            : "No feasible lineup with those locks and the salary cap. Unlock someone or raise the cap in your head — this slate is $50k.",
        );
      setBusy(false);
    }, 20);
  };

  const slots = lineup ? orderedLineup(lineup.players) : [];
  const usedPct = lineup ? lineup.salary / data.cap : 0;
  const actualTotal = lineup
    ? lineup.players.reduce((s, p) => s + (actuals.get(p.id) ?? 0), 0)
    : 0;
  const scored = lineup ? lineup.players.filter((p) => actuals.has(p.id)).length : 0;
  const leader = week?.players[0];

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
                <tbody>
                  {filtered.map((p) => {
                    const isL = locked.includes(p.id);
                    const isX = excluded.includes(p.id);
                    const val = p.proj / (p.salary / 1000);
                    const act = actuals.get(p.id);
                    return (
                      <tr
                        key={p.id}
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
                                  onClick={() => {
                                    toggle(locked, p.id, setLocked);
                                    if (!isL) setExcluded((e) => e.filter((x) => x !== p.id));
                                  }}
                                  className={cn(
                                    "grid size-9 place-items-center rounded-sm",
                                    isL ? "bg-sage/20 text-sage" : "text-subtle hover:bg-elevated hover:text-fg",
                                  )}
                                >
                                  <Lock className="size-3.5" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {isL ? "Locked — always in the lineup" : "Lock: force this player into the lineup"}
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={isX ? "Include" : "Bench / exclude"}
                                  onClick={() => {
                                    toggle(excluded, p.id, setExcluded);
                                    if (!isX) setLocked((e) => e.filter((x) => x !== p.id));
                                  }}
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
              </table>
            </div>
          </div>

          <aside className="flex flex-col gap-4">
            <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
              <p className="text-[11px] tracking-[0.16em] text-subtle uppercase">Solve</p>
              <label className="mt-4 flex items-center gap-3 text-sm">
                <Checkbox checked={stack} onCheckedChange={(v) => setStack(v === true)} />
                Stack QB with a WR/TE
              </label>
              <label className="mt-3 flex items-center gap-3 text-sm">
                <Checkbox
                  checked={mode === "actual"}
                  onCheckedChange={(v) => setMode(v === true ? "actual" : "proj")}
                  disabled={!week || actuals.size < 9}
                />
                Solve on this week’s actuals
              </label>
              <p className="mt-2 text-xs text-subtle">
                {locked.length} locked · {excluded.length} excluded
                {week ? ` · ${actuals.size} scored` : ""}
              </p>
              <Button className="mt-5 w-full" onClick={run} disabled={busy}>
                {busy ? "Solving…" : mode === "actual" ? "Hindsight lineup" : "Build lineup"}
              </Button>
              {error && <p className="mt-3 text-sm text-rust">{error}</p>}
            </div>

            {lineup && (
              <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="font-display text-xl uppercase tracking-[0.06em]">
                    {mode === "actual" ? "Hindsight" : "Optimal"}
                  </h2>
                  <Badge variant="sage">{lineup.proj.toFixed(1)} pts</Badge>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-elevated">
                  <div className="h-full bg-accent" style={{ width: `${Math.min(100, usedPct * 100)}%` }} />
                </div>
                <p className="mt-2 font-mono text-xs text-muted">
                  ${formatNum(lineup.salary)} / ${formatNum(data.cap)} · ${formatNum(lineup.remaining)} left
                </p>
                {week && (
                  <p className="mt-1 font-mono text-xs text-sage">
                    {actualTotal.toFixed(1)} actual · {scored}/{lineup.players.length} scored
                  </p>
                )}
                <ul className="mt-4 divide-y divide-border">
                  {slots.map(({ slot, player }) => {
                    const act = actuals.get(player.id);
                    return (
                      <li key={player.id} className="flex items-center justify-between gap-2 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="w-8 font-mono text-[10px] text-subtle">{slot}</span>
                          <span className="truncate text-sm">{player.name}</span>
                        </div>
                        <span className="font-mono text-xs tabular-nums text-muted">
                          {mode === "actual" ? player.proj.toFixed(1) : player.proj.toFixed(1)}
                          {act != null && mode === "proj" ? (
                            <span className="ml-2 text-sage">{act.toFixed(1)}</span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {alt && (
              <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
                <h2 className="font-display text-lg uppercase tracking-[0.06em]">Value greedy</h2>
                <p className="mt-2 font-mono text-sm">{alt.proj.toFixed(1)} pts</p>
              </div>
            )}

            {backtest && (
              <div className="rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]">
                <h2 className="font-display text-lg uppercase tracking-[0.06em]">Backtest</h2>
                <p className="mt-1 text-xs text-muted">
                  Solved on projections, scored on this week’s actuals.
                </p>
                <table className="mt-3 w-full text-left text-sm">
                  <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
                    <tr>
                      <th className="py-1 font-medium"> </th>
                      <th className="py-1 text-right font-medium">Proj</th>
                      <th className="py-1 text-right font-medium">Actual</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    <tr className="border-t border-border/70">
                      <td className="py-1.5">Exact DP</td>
                      <td className="py-1.5 text-right">{backtest.exact.proj.toFixed(1)}</td>
                      <td className="py-1.5 text-right">{backtest.exact.actual.pts.toFixed(1)}</td>
                    </tr>
                    <tr className="border-t border-border/70">
                      <td className="py-1.5">Hill-climb</td>
                      <td className="py-1.5 text-right">{backtest.hill.proj.toFixed(1)}</td>
                      <td className="py-1.5 text-right">{backtest.hill.actual.pts.toFixed(1)}</td>
                    </tr>
                    <tr className="border-t border-border/70">
                      <td className="py-1.5">Pts/$ greedy</td>
                      <td className="py-1.5 text-right">{backtest.value.proj.toFixed(1)}</td>
                      <td className="py-1.5 text-right">{backtest.value.actual.pts.toFixed(1)}</td>
                    </tr>
                    <tr className="border-t border-border/70">
                      <td className="py-1.5">Hindsight</td>
                      <td className="py-1.5 text-right text-muted">—</td>
                      <td className="py-1.5 text-right">{backtest.hindsight.toFixed(1)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
