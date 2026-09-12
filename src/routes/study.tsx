import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import backtestFile from "@/data/study-backtest.json";
import ewmaFile from "@/data/study-ewma.json";
import lagFile from "@/data/study-qb-lag.json";
import projFile from "@/data/study-projections.json";
import { AppShell } from "@/components/layout/AppShell";
import { axisProps, CHART } from "@/components/charts/theme";
import type { BacktestFile, EwmaFile, ProjectionFile, QbLagFile } from "@/data/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/study")({ component: StudyPage });

const backtest = backtestFile as BacktestFile;
const lag = lagFile as QbLagFile;
const projections = projFile as ProjectionFile;
const ewma = ewmaFile as EwmaFile;

function pearson(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? null : num / den;
}

const guessXs = backtest.weeks.map((w) => w.exact.proj);
const guessYs = backtest.weeks.map((w) => w.exact.actual);
const guessMean = guessXs.reduce((s, x) => s + x, 0) / guessXs.length;
const realMean = guessYs.reduce((s, y) => s + y, 0) / guessYs.length;
const guessBias = guessMean - realMean;
const guessR = pearson(guessXs, guessYs);
const guessHigh = backtest.weeks.filter((w) => w.exact.proj > w.exact.actual).length;
const guessDots = backtest.weeks.map((w) => ({
  week: w.week,
  proj: w.exact.proj,
  actual: w.exact.actual,
}));


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
          Two questions on 2025, plus which projection actually scores.
        </p>

        {!ready ? (
          <p className="mt-10 text-sm text-muted">Computing the 2025 holdout…</p>
        ) : (
          <>
            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Question</h2>
              <p className="mt-3 text-sm leading-relaxed">
                After the games, does the $50k solver score more real PPR than just taking the
                highest projected names that still fit? And if a QB was good last week on EPA or
                CPOE, is he good this week?
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
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Guess vs real</h2>
              <p className="mt-3 text-sm leading-relaxed">
                The Exact column above is actual PPR. The solver’s own sum of projections averaged{" "}
                {guessMean.toFixed(1)}. Real was {realMean.toFixed(1)}. High by{" "}
                {guessBias.toFixed(1)} every week ({guessHigh}/{backtest.weeks.length}). Correlation
                between guessed total and real total is r = {guessR == null ? "—" : guessR.toFixed(2)}.
                Trailing mean per player is only off ~6.6 PPR. The $50k roster is nine of the fattest
                means — players who already got lucky — so the packed total is ~60 points of fiction.
              </p>
              <div className="mt-6 h-[240px] rounded-xl bg-surface p-3 shadow-[var(--shadow-border)] sm:p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
                    <CartesianGrid stroke={CHART.grid} />
                    <XAxis
                      type="number"
                      dataKey="proj"
                      name="Guess"
                      domain={[50, 220]}
                      tickCount={5}
                      {...axisProps}
                      tick={{ fill: "#C5CCD6", fontSize: 11 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="actual"
                      name="Real"
                      domain={[50, 220]}
                      width={36}
                      tickCount={5}
                      {...axisProps}
                      tick={{ fill: "#C5CCD6", fontSize: 11 }}
                    />
                    <ReferenceLine
                      segment={[
                        { x: 50, y: 50 },
                        { x: 220, y: 220 },
                      ]}
                      stroke={CHART.muted}
                      strokeDasharray="4 4"
                    />
                    <Tooltip content={<GuessTip />} />
                    <Scatter data={guessDots} fill={CHART.paper} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted">
                X = solver guess · Y = actual · dashed is perfect. All 17 weeks sit below it.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Projections</h2>
              <p className="mt-3 text-sm leading-relaxed">
                Same slate, same cap, same weeks. Only the guess of next week’s PPR changes. MAE is
                error per player who played. Lineup is actual PPR of exact-DP using that guess.
                Shrinkage is the most accurate player-level forecast and a worse lineup — it flattens
                stars. EWMA is a little noisier per player and the only model that moved the lineup
                table (+2.4 vs trailing mean). Opponent-adjust with thin splits broke the solver.
                α=0.35 was one point on a noisy ridge — see the sweep below.
              </p>
              <div className="mt-6 overflow-x-auto rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
                    <tr className="border-b border-border">
                      <th className="py-2 font-medium">Model</th>
                      <th className="py-2 text-right font-medium">MAE</th>
                      <th className="py-2 text-right font-medium">Lineup</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums">
                    {[...projections.models]
                      .sort((a, b) => b.lineupMean - a.lineupMean)
                      .map((m) => (
                        <tr key={m.id} className="border-b border-border/70">
                          <td className="py-1.5 font-sans">{m.label}</td>
                          <td className={cn("py-1.5 text-right", m.id === "shrink" ? "text-sage" : undefined)}>
                            {m.mae.toFixed(2)}
                          </td>
                          <td
                            className={cn(
                              "py-1.5 text-right",
                              m.id === "ewma" ? "text-sage" : m.lineupMean < 90 ? "text-muted" : undefined,
                            )}
                          >
                            {m.lineupMean.toFixed(1)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">EWMA α</h2>
              <p className="mt-3 text-sm leading-relaxed">
                α=1 is last week only. Small α is not the season mean — it sticks to week 1. Trailing
                mean MAE is {ewma.trail.mae}, lineup {ewma.trail.lineupMean}. Best lineup on this
                sweep is α={ewma.bestLineup.alpha} at {ewma.bestLineup.lineupMean} actual points. Best
                MAE is α={ewma.bestMae.alpha} at {ewma.bestMae.mae}. Neighbors of the lineup peak
                drop several points. 17 weeks is not enough to treat {ewma.bestLineup.alpha} as a
                fitted parameter.
              </p>
              <div className="mt-6 h-[240px] rounded-xl bg-surface p-3 shadow-[var(--shadow-border)] sm:p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={ewma.points} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke={CHART.grid} />
                    <XAxis
                      dataKey="alpha"
                      type="number"
                      domain={[0, 1]}
                      ticks={[0.2, 0.4, 0.6, 0.8, 1]}
                      {...axisProps}
                      tick={{ fill: "#C5CCD6", fontSize: 11 }}
                    />
                    <YAxis
                      domain={[105, 125]}
                      width={36}
                      {...axisProps}
                      tick={{ fill: "#C5CCD6", fontSize: 11 }}
                    />
                    <ReferenceLine
                      y={ewma.trail.lineupMean}
                      stroke={CHART.muted}
                      strokeDasharray="4 4"
                    />
                    <Tooltip content={<AlphaTip trail={ewma.trail.lineupMean} />} />
                    <Line
                      type="linear"
                      dataKey="lineupMean"
                      stroke={CHART.paper}
                      strokeWidth={2}
                      dot={{ r: 3, fill: CHART.paper }}
                      activeDot={{ r: 5, fill: CHART.sage }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted">
                Lineup actual vs α. Dashed line is trailing mean ({ewma.trail.lineupMean}).
              </p>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">QB lag</h2>
              <p className="mt-3 text-sm leading-relaxed">
                r = {lag.corrEpa ?? "—"} for EPA/attempt, r = {lag.corrCpoe ?? "—"} for CPOE,{" "}
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
                  Shrinkage wins MAE (6.23) and loses lineup (112.9). Ranking stars is not the same
                  job as predicting every player.
                </li>
                <li>
                  A naive opponent adjustment averaged 67.8 lineup points. Thin splits are worse than
                  no opponent term.
                </li>
                <li>
                  EWMA α=0.30 peaked at {ewma.bestLineup.lineupMean} on this sweep; α=0.40 is 114.3.
                  Do not fit α on 17 weeks.
                </li>
                <li>
                  Exact’s guessed total averaged {guessMean.toFixed(1)} against {realMean.toFixed(1)}{" "}
                  actual. High every week. That is winner’s curse on trailing means, not a solver bug.
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

function GuessTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { week: number; proj: number; actual: number } }>;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md bg-elevated px-3 py-2.5 text-sm text-fg shadow-[var(--shadow-border-hover)]">
      <p className="font-medium">Week {d.week}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
        <dt className="text-muted">Guess</dt>
        <dd>{d.proj.toFixed(1)}</dd>
        <dt className="text-muted">Real</dt>
        <dd>{d.actual.toFixed(1)}</dd>
      </dl>
    </div>
  );
}

function AlphaTip({
  active,
  payload,
  trail,
}: {
  active?: boolean;
  payload?: Array<{ payload: { alpha: number; lineupMean: number; mae: number } }>;
  trail: number;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md bg-elevated px-3 py-2.5 text-sm text-fg shadow-[var(--shadow-border-hover)]">
      <p className="font-medium">α {d.alpha.toFixed(2)}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
        <dt className="text-muted">Lineup</dt>
        <dd>{d.lineupMean.toFixed(1)}</dd>
        <dt className="text-muted">MAE</dt>
        <dd>{d.mae.toFixed(2)}</dd>
        <dt className="text-muted">Trail</dt>
        <dd>{trail.toFixed(1)}</dd>
      </dl>
    </div>
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
