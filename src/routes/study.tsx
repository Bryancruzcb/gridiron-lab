import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import backtestFile from "@/data/study-backtest.json";
import lagFile from "@/data/study-qb-lag.json";
import { AppShell } from "@/components/layout/AppShell";
import { axisProps, CHART } from "@/components/charts/theme";
import type { BacktestFile, QbLagFile } from "@/data/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/study")({ component: StudyPage });

const backtest = backtestFile as BacktestFile;
const lag = lagFile as QbLagFile;

function StudyPage() {
  const s = backtest.summary;
  const ready = s.weeks > 0 && lag.n > 0;

  return (
    <AppShell>
      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <p className="text-sm text-muted">
          <Link to="/" className="hover:text-fg">
            Home
          </Link>
        </p>
        <h1 className="mt-3 font-display text-5xl uppercase tracking-[0.03em]">Study</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted">
          Two questions on 2025. Held out. Not a dashboard.
        </p>

        {!ready ? (
          <p className="mt-10 text-sm text-muted">Computing the 2025 holdout…</p>
        ) : (
          <>
            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Question</h2>
              <p className="mt-3 text-sm leading-relaxed">
                Does a cap-optimal $50k lineup beat picking the highest projections that still fit,
                once you score it on actual PPR the following week? And does last week’s EPA or CPOE
                tell you this week’s?
              </p>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Data</h2>
              <p className="mt-3 text-sm leading-relaxed">
                nflverse 2025 regular season, player week and team week. Frozen 114-player slate.
                Salaries are synthetic DraftKings-style prices — not live DK. Projection is trailing
                mean PPR from weeks 1 through w−1. Week 1 is dropped. DST points-allowed is estimated
                from opponent TDs, field goals, and PATs.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Method</h2>
              <p className="mt-3 text-sm leading-relaxed">
                Each week: exact DP (hill-climb if DP misses a legal roster) vs projection-greedy vs
                pts/$ greedy. Score the nine names on that week’s actual PPR. For QBs: consecutive
                weeks with ≥15 attempts. EPA is passing EPA per attempt. Pearson r on 409 pairs.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Lineup result</h2>
              <p className="mt-3 text-sm leading-relaxed">
                Exact averaged {s.exactMean} actual points (median {s.exactMedian}). Projection-greedy
                averaged {s.greedyProjMean}. Pts/$ greedy averaged {s.greedyValueMean}. Exact beat
                projection-greedy in {s.exactBeatsProj} of {s.weeks} weeks, and beat value-greedy in{" "}
                {s.exactBeatsValue} of {s.weeks}. A 0.7-point edge over greedy-proj is not a product.
                It is a small, noisy holdout.
              </p>
              <div className="mt-6 overflow-x-auto rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
                    <tr className="border-b border-border">
                      <th className="py-2 font-medium">Week</th>
                      <th className="py-2 text-right font-medium">Exact</th>
                      <th className="py-2 text-right font-medium">Greedy proj</th>
                      <th className="py-2 text-right font-medium">Pts/$</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {backtest.weeks.map((w) => (
                      <tr key={w.week} className="border-b border-border/70">
                        <td className="py-1.5">{w.week}</td>
                        <td
                          className={cn(
                            "py-1.5 text-right",
                            w.exact.actual > w.greedyProj.actual ? "text-sage" : undefined,
                          )}
                        >
                          {w.exact.actual.toFixed(1)}
                        </td>
                        <td className="py-1.5 text-right">{w.greedyProj.actual.toFixed(1)}</td>
                        <td className="py-1.5 text-right text-muted">{w.greedyValue.actual.toFixed(1)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-2">Mean</td>
                      <td className="py-2 text-right">{s.exactMean.toFixed(1)}</td>
                      <td className="py-2 text-right">{s.greedyProjMean.toFixed(1)}</td>
                      <td className="py-2 text-right text-muted">{s.greedyValueMean.toFixed(1)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">QB lag</h2>
              <p className="mt-3 text-sm leading-relaxed">
                r = {lag.corrEpa ?? "—"} for EPA/attempt, r = {lag.corrCpoe ?? "—"} for CPOE, n ={" "}
                {lag.n} consecutive-week pairs. Last week’s number is a weak forecast of this week.
                The QB lab describes what already happened. It does not pick next week’s winner.
              </p>
              <div className="mt-6 h-[320px] rounded-xl bg-surface p-3 shadow-[var(--shadow-border)] sm:p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
                    <CartesianGrid stroke={CHART.grid} />
                    <XAxis
                      type="number"
                      dataKey="epaPrev"
                      name="Last week"
                      tickCount={5}
                      {...axisProps}
                      tick={{ fill: "#C5CCD6", fontSize: 11 }}
                      tickFormatter={(v: number) => v.toFixed(1)}
                    />
                    <YAxis
                      type="number"
                      dataKey="epaNext"
                      name="This week"
                      width={40}
                      tickCount={5}
                      {...axisProps}
                      tick={{ fill: "#C5CCD6", fontSize: 11 }}
                      tickFormatter={(v: number) => v.toFixed(1)}
                    />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<LagTip />} />
                    <Scatter data={lag.pairs} fill={CHART.paper} fillOpacity={0.55} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted">X last week EPA/att · Y this week · 15+ attempts</p>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">What failed</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
                {backtest.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
                <li>
                  Trailing-mean PPR is a weak projection. A better forecast would move the backtest
                  more than a better solver.
                </li>
                <li>
                  Exact beat greedy-proj only {s.exactBeatsProj}/{s.weeks} weeks. Cap-optimal on a bad
                  projection is still a bad lineup.
                </li>
                <li>
                  EPA and CPOE persist only a little (r ≈ 0.16). Week 1 of 2026 is still a thin sample.
                </li>
              </ul>
            </section>
          </>
        )}
      </article>
    </AppShell>
  );
}

function LagTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload: { name: string; team: string; week: number; epaPrev: number; epaNext: number; attNext: number; cpoePrev: number | null };
  }>;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md bg-elevated px-3 py-2.5 text-sm text-fg shadow-[var(--shadow-border-hover)]">
      <p className="font-medium">{d.name}</p>
      <p className="text-xs text-muted">
        {d.team} · week {d.week}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
        <dt className="text-muted">Last EPA</dt>
        <dd>{d.epaPrev.toFixed(2)}</dd>
        <dt className="text-muted">This EPA</dt>
        <dd>{d.epaNext.toFixed(2)}</dd>
        <dt className="text-muted">Attempts</dt>
        <dd>{d.attNext}</dd>
      </dl>
    </div>
  );
}
