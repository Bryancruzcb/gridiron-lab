import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import playFile from "@/data/playcalling.json";
import snapFile from "@/data/season2026.json";
import { AppShell } from "@/components/layout/AppShell";
import { FirstLook } from "@/components/FirstLook";
import { StatTip } from "@/components/StatTip";
import { Segmented } from "@/components/ui/segmented";
import { axisProps, CHART, tooltipStyle } from "@/components/charts/theme";
import type { PlaycallingFile, TeamSeason } from "@/data/types";
import { getSeasonLabs } from "@/lib/live/functions";
import type { SeasonLabs } from "@/lib/live/types";
import { teamNick } from "@/lib/nfl";
import { cn, formatEpa, formatPct } from "@/lib/utils";

export const Route = createFileRoute("/play-calling")({ component: PlayLab });

const data = playFile as unknown as PlaycallingFile;
const snap = snapFile as unknown as SeasonLabs;
const DOWNS = [1, 2, 3, 4] as const;
const DISTS = ["short", "medium", "long"] as const;

function teamFromClick(d: unknown): string | null {
  if (!d || typeof d !== "object") return null;
  const rec = d as { team?: string; payload?: { team?: string } };
  return rec.team ?? rec.payload?.team ?? null;
}

function PlayLab() {
  const [season26, setSeason26] = useState<SeasonLabs | null>(null);
  const [season, setSeason] = useState(2026);
  const [metric, setMetric] = useState<"fourth" | "second" | "proe">("fourth");
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const heatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    getSeasonLabs()
      .then((s) => {
        if (!cancelled) setSeason26(s);
      })
      .catch(() => {
        if (!cancelled) {
          setSeason26(null);
          setSeason((s) => (s === 2026 ? 2025 : s));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const overlay = season26?.teams.length ? season26 : snap;
  const allTeams = useMemo(() => {
    const hist = data.teams as TeamSeason[];
    return [...overlay.teams, ...hist.filter((t) => t.season !== 2026)];
  }, [overlay]);

  const seasons = useMemo(() => {
    const s = new Set(allTeams.map((t) => t.season));
    return [...s].sort((a, b) => b - a);
  }, [allTeams]);

  const teams = useMemo(() => allTeams.filter((t) => t.season === season), [allTeams, season]);
  const selectedTeam = teams.find((t) => t.team === selected) ?? null;

  const pickTeam = (team: string | null) => {
    if (!team) return;
    setSelected(team);
    setFlash((n) => n + 1);
    requestAnimationFrame(() => {
      heatRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };

  const fourth = teams
    .slice()
    .sort((a, b) => (b.fourthDown.goRate ?? 0) - (a.fourthDown.goRate ?? 0))
    .map((t) => ({
      team: t.team,
      name: teamNick(t.team),
      go: (t.fourthDown.goRate ?? 0) * 100,
      convert: (t.fourthDown.convertRate ?? 0) * 100,
      coach: t.coach,
    }));

  const second = teams
    .slice()
    .sort((a, b) => (b.secondAndShort.passRate ?? 0) - (a.secondAndShort.passRate ?? 0))
    .map((t) => ({
      team: t.team,
      name: teamNick(t.team),
      pass: (t.secondAndShort.passRate ?? 0) * 100,
      epaPass: t.secondAndShort.epaPass ?? 0,
      epaRush: t.secondAndShort.epaRush ?? 0,
    }));

  const proe = teams.map((t) => ({
    team: t.team,
    name: teamNick(t.team),
    proe: t.proe ?? 0,
    epa: t.epa ?? 0,
    passRate: (t.passRate ?? 0) * 100,
  }));

  const heat = selectedTeam
    ? DOWNS.map((d) => {
        const row: Record<string, string | number | null> = { down: `${d}` };
        for (const dist of DISTS) {
          const s = selectedTeam.splits[`down${d}_${dist}`];
          row[dist] = s && s.plays > 0 && s.passRate != null ? Math.round(s.passRate * 100) : null;
          row[`${dist}Plays`] = s?.plays ?? 0;
        }
        return row;
      })
    : [];

  const topGo = fourth[0];
  const passHappy = second[0];
  const mostProe = proe.slice().sort((a, b) => b.proe - a.proe)[0];

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <header className="max-w-2xl">
          <h1 className="font-display text-5xl uppercase tracking-[0.03em] sm:text-6xl">
            Play-calling
          </h1>
        </header>
        <FirstLook id="play" title="This page">
          <p>Ranked list of every team. Tap a row for the down × distance heatmap. A dash means no plays in that bucket.</p>
        </FirstLook>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Segmented
            value={String(season)}
            onChange={(v) => {
              setSeason(Number(v));
              setSelected(null);
            }}
            options={seasons.map((s) => ({ value: String(s), label: String(s) }))}
          />
          <Segmented
            value={metric}
            onChange={setMetric}
            options={[
              { value: "fourth", label: "4th down" },
              { value: "second", label: "2nd & short" },
              { value: "proe", label: "PROE" },
            ]}
          />
          <span className="text-[11px] tracking-[0.14em] text-subtle uppercase">
            {season >= 2026 && overlay.throughWeek
              ? `through week ${overlay.throughWeek}`
              : `${teams.length} teams`}
          </span>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Insight
            kicker="Goes for it"
            title={topGo ? teamNick(topGo.team) : "—"}
            body={
              topGo
                ? `${formatPct((topGo.go ?? 0) / 100)} of 4th downs${topGo.coach ? ` · ${topGo.coach}` : ""}`
                : ""
            }
          />
          <Insight
            kicker="Throws on 2nd & short"
            title={passHappy ? teamNick(passHappy.team) : "—"}
            body={passHappy ? `${passHappy.pass.toFixed(0)}% pass rate when ydstogo ≤ 3` : ""}
          />
          <Insight
            kicker="Pass-happy vs model"
            title={mostProe ? teamNick(mostProe.team) : "—"}
            body={mostProe ? `${mostProe.proe > 0 ? "+" : ""}${mostProe.proe.toFixed(1)} PROE` : ""}
          />
        </div>

        <div className="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
            {metric === "fourth" && (
              <>
                <h2 className="font-display text-xl uppercase tracking-[0.06em]">
                  <StatTip metric="fourthGo">4th-down go rate</StatTip>
                </h2>
                <p className="mt-1 text-xs text-muted">
                  {teams.length} teams{teams.length > 8 ? " · scroll" : ""}
                </p>
                <RankBars
                  rows={fourth.map((t) => ({
                    team: t.team,
                    value: t.go,
                    selected: selected === t.team,
                  }))}
                  format={(v) => `${v.toFixed(0)}%`}
                  onPick={pickTeam}
                />
              </>
            )}
            {metric === "second" && (
              <>
                <h2 className="font-display text-xl uppercase tracking-[0.06em]">
                  <StatTip metric="secondShort">2nd-and-short pass rate</StatTip>
                </h2>
                <p className="mt-1 text-xs text-muted">
                  2nd-and-1 to 3 · {teams.length} teams
                  {teams.length > 8 ? " · scroll" : ""}
                </p>
                <RankBars
                  rows={second.map((t) => ({
                    team: t.team,
                    value: t.pass,
                    selected: selected === t.team,
                  }))}
                  format={(v) => `${v.toFixed(0)}%`}
                  onPick={pickTeam}
                />
              </>
            )}
            {metric === "proe" && (
              <>
                <h2 className="font-display text-xl uppercase tracking-[0.06em]">
                  <StatTip metric="proe">PROE</StatTip>
                  <span className="text-muted"> vs </span>
                  <StatTip metric="epa">EPA</StatTip>
                </h2>
                <div className="mt-4 h-[360px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ left: 0, right: 8, top: 8, bottom: 8 }}>
                      <CartesianGrid stroke={CHART.grid} />
                      <XAxis dataKey="proe" type="number" name="PROE" {...axisProps} />
                      <YAxis dataKey="epa" type="number" name="EPA" {...axisProps} />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        labelFormatter={(_, p) => p?.[0]?.payload?.name ?? ""}
                      />
                      <Scatter data={proe} onClick={(d) => pickTeam(teamFromClick(d))}>
                        {proe.map((t) => (
                          <Cell key={t.team} fill={selected === t.team ? CHART.sage : CHART.paper} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>

          <div
            ref={heatRef}
            key={flash}
            className={cn(
              "rounded-xl bg-surface p-5 shadow-[var(--shadow-border)] lg:sticky lg:top-20",
              selectedTeam && "heat-flash",
            )}
          >
            {selectedTeam ? (
              <>
                <p className="text-[11px] tracking-[0.16em] text-sage uppercase">Now viewing</p>
                <h2 className="mt-1 font-display text-3xl uppercase tracking-[0.04em]">
                  {teamNick(selectedTeam.team)}
                </h2>
                {selectedTeam.coach ? <p className="mt-1 text-sm text-muted">{selectedTeam.coach}</p> : null}
                <dl className="mt-4 grid grid-cols-2 gap-3">
                  <Stat label="Pass rate" value={formatPct(selectedTeam.passRate)} />
                  <Stat
                    label="PROE"
                    value={
                      selectedTeam.proe == null
                        ? "—"
                        : `${selectedTeam.proe > 0 ? "+" : ""}${selectedTeam.proe.toFixed(1)}`
                    }
                  />
                  <Stat label="EPA/play" value={formatEpa(selectedTeam.epa)} />
                  <Stat
                    label="4th go / conv"
                    value={`${formatPct(selectedTeam.fourthDown.goRate)} · ${formatPct(selectedTeam.fourthDown.convertRate)}`}
                  />
                </dl>
                <p className="mt-6 text-[11px] tracking-[0.14em] text-subtle uppercase">
                  Pass rate by down × distance
                </p>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[280px] text-center text-sm">
                    <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
                      <tr>
                        <th className="px-2 py-2 text-left font-medium">Down</th>
                        <th className="px-2 py-2 font-medium">Short</th>
                        <th className="px-2 py-2 font-medium">Medium</th>
                        <th className="px-2 py-2 font-medium">Long</th>
                      </tr>
                    </thead>
                    <tbody>
                      {heat.map((row) => (
                        <tr key={String(row.down)} className="border-t border-border">
                          <td className="px-2 py-3 text-left text-muted">{row.down}</td>
                          {DISTS.map((d) => {
                            const raw = row[d];
                            const v = typeof raw === "number" ? raw : null;
                            const plays = Number(row[`${d}Plays`] ?? 0);
                            if (v == null) {
                              return (
                                <td key={d} className="px-2 py-3">
                                  <span className="inline-flex min-h-11 min-w-[3.5rem] items-center justify-center font-mono text-subtle">
                                    —
                                  </span>
                                </td>
                              );
                            }
                            const bg = `color-mix(in oklab, var(--color-sage) ${v}%, transparent)`;
                            return (
                              <td key={d} className="px-2 py-3">
                                <span
                                  title={`${plays} play${plays === 1 ? "" : "s"}`}
                                  className={cn(
                                    "inline-flex min-h-11 min-w-[3.5rem] items-center justify-center rounded-sm px-2 font-mono tabular-nums",
                                    v > 55 ? "text-fg" : "text-muted",
                                  )}
                                  style={{ background: bg }}
                                >
                                  {v}%
                                </span>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="flex min-h-[200px] flex-col justify-center">
                <p className="font-display text-2xl uppercase tracking-[0.04em]">Heatmap</p>
                <p className="mt-2 text-sm text-muted">Tap a team in the list.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function RankBars({
  rows,
  format,
  onPick,
}: {
  rows: { team: string; value: number; selected: boolean }[];
  format: (v: number) => string;
  onPick: (team: string) => void;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ol className="mt-3 max-h-[min(70dvh,32rem)] space-y-0.5 overflow-y-auto overscroll-contain pr-1">
      {rows.map((r, i) => (
        <li key={r.team}>
          <button
            type="button"
            onClick={() => onPick(r.team)}
            className={cn(
              "flex min-h-11 w-full items-center gap-2 rounded-sm px-1.5 text-left",
              r.selected ? "bg-sage/15" : "hover:bg-elevated",
            )}
          >
            <span className="w-5 shrink-0 font-mono text-[10px] text-subtle tabular-nums">{i + 1}</span>
            <span className="w-8 shrink-0 font-mono text-xs">{r.team}</span>
            <span className="relative h-2 min-w-0 flex-1 rounded-full bg-elevated">
              <span
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  r.selected ? "bg-sage" : "bg-accent",
                )}
                style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }}
              />
            </span>
            <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums">{format(r.value)}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function Insight({ kicker, title, body }: { kicker: string; title: string; body: string }) {
  return (
    <div className="rounded-lg bg-surface p-4 shadow-[var(--shadow-border)]">
      <p className="text-[11px] tracking-[0.14em] text-subtle uppercase">{kicker}</p>
      <p className="mt-2 font-display text-2xl uppercase tracking-[0.04em]">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] tracking-[0.12em] text-subtle uppercase">{label}</dt>
      <dd className="mt-1 font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}
