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

const guessXs = backtest.weeks.map((w) => w.exact.proj);
const guessYs = backtest.weeks.map((w) => w.exact.actual);
const guessMean = guessXs.reduce((s, x) => s + x, 0) / guessXs.length;
const realMean = guessYs.reduce((s, y) => s + y, 0) / guessYs.length;
const guessBias = guessMean - realMean;
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
          A check on last season. Did the Lineup computer actually help, and does last week’s QB
          number predict this week?
        </p>

        {!ready ? (
          <p className="mt-10 text-sm text-muted">Loading 2025…</p>
        ) : (
          <>
            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">What this is</h2>
              <p className="mt-3 text-sm leading-relaxed">
                Fantasy lineups here have a <strong className="font-medium text-fg">$50,000 budget</strong>,
                like DraftKings. You pick 9 players. Stars cost more. The Lineup page has a computer
                that builds a team under that budget. This page is not a live tool. It is a test
                from the 2025 season: we locked the prices, let the computer pick, then scored the
                team on points the players actually got that week.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Two questions</h2>
              <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm leading-relaxed">
                <li>
                  After the games, did the computer’s $50k team score more points than just taking
                  the highest-projected names that still fit the budget?
                </li>
                <li>
                  If a quarterback looked good last week (EPA or CPOE), did he look good this week
                  too?
                </li>
              </ol>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">How we tested</h2>
              <p className="mt-3 text-sm leading-relaxed">
                17 weeks in 2025 (week 1 skipped — no history yet). Same fake prices all year, not
                live DraftKings. “Projected” means each player’s average fantasy points so far. Then
                we scored whoever got picked on the points they really scored that Sunday.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Did the computer help?</h2>
              <p className="mt-3 text-sm leading-relaxed">
                Barely. The computer averaged <strong className="font-medium text-fg">{s.exactMean}</strong>{" "}
                real points a week. Grabbing the top projected names averaged {s.greedyProjMean}.
                That’s a { (s.exactMean - s.greedyProjMean).toFixed(1) }-point gap — inside the noise.
                It only won {s.exactBeatsProj} of {s.weeks} weeks. Picking “cheap production” (most
                projected points per dollar) was worse: {s.greedyValueMean}.
              </p>
              <p className="mt-3 text-sm text-muted">
                Green = computer beat the top-names pick that week.
              </p>
              <div className="mt-6 overflow-x-auto rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
                    <tr className="border-b border-border">
                      <th className="py-2 font-medium">Week</th>
                      <th className="py-2 text-right font-medium">Computer</th>
                      <th className="py-2 text-right font-medium">Top names</th>
                      <th className="py-2 text-right font-medium">Cheap picks</th>
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
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">The computer was too optimistic</h2>
              <p className="mt-3 text-sm leading-relaxed">
                The table above is <em>real</em> points after the games. Before kickoff the computer
                thought its team would score about {guessMean.toFixed(0)}. They actually scored about{" "}
                {realMean.toFixed(0)}. It overshot every single week ({guessHigh} of{" "}
                {backtest.weeks.length}), by ~{guessBias.toFixed(0)} points. It packed the roster
                with players who had been hot, and hot streaks cool off. That’s the hole — not the
                picker math.
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
                Each dot is a week. Perfect guesses would sit on the dashed line. Every week is under
                it — the computer always thought it would score more than it did.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Better guesses?</h2>
              <p className="mt-3 text-sm leading-relaxed">
                Same budget, same weeks. We only changed how we guess next week’s points. “Miss” is
                how far off we were on each player. “Team score” is what the computer’s 9-man roster
                actually got with that guess. Closer on every player is not the same as a better
                team — flattening stars looks accurate and still loses Sundays.
              </p>
              <div className="mt-6 overflow-x-auto rounded-xl bg-surface p-4 shadow-[var(--shadow-border)] sm:p-5">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead className="text-[11px] tracking-[0.12em] text-subtle uppercase">
                    <tr className="border-b border-border">
                      <th className="py-2 font-medium">Guess method</th>
                      <th className="py-2 text-right font-medium">Miss / player</th>
                      <th className="py-2 text-right font-medium">Team score</th>
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
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">How much to trust last week</h2>
              <p className="mt-3 text-sm leading-relaxed">
                Far left = mostly the season so far. Far right = only last week. The dashed line is
                “just use their average so far.” One setting looked a couple of points better on
                this season. 17 weeks is too small to treat that as a discovery.
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
                Team’s real points vs how hard we weight last week. Dashed = season average so far (
                {ewma.trail.lineupMean}).
              </p>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Do hot QBs stay hot?</h2>
              <p className="mt-3 text-sm leading-relaxed">
                Almost no. Last week’s EPA barely lines up with this week’s (r = {lag.corrEpa ?? "—"}
                , {lag.n} QB-weeks with 15+ throws). CPOE is the same story (r = {lag.corrCpoe ?? "—"}
                ). The QB page is a report card on what already happened. It is not a crystal ball
                for next Sunday.
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
              <p className="mt-2 text-xs text-muted">
                Left = last week’s EPA per throw. Up = this week. A tight diagonal would mean last
                week predicts this week. This is a cloud.
              </p>
            </section>

            <section className="mt-10">
              <h2 className="font-display text-2xl uppercase tracking-[0.04em]">What went wrong</h2>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
                <li>
                  Prices are fake DraftKings-style numbers we froze all year — not the real weekly
                  salary board.
                </li>
                <li>
                  The computer thought it would score ~{guessMean.toFixed(0)} and scored ~
                  {realMean.toFixed(0)}. That’s packing last week’s luck, not a bug in the picker.
                </li>
                <li>
                  Guessing “closer on every player” (shrink) missed less per name and still built a
                  worse team. Stars got flattened.
                </li>
                <li>
                  Tweaking for opponent looked smart and built terrible teams. Thin samples hurt more
                  than they help.
                </li>
                <li>
                  One “weight last week” setting looked a couple of points better. Don’t trust a
                  setting fitted on 17 weeks.
                </li>
                <li>
                  A good EPA week barely predicts the next one. Week 1 of 2026 is still a tiny sample
                  in the live labs.
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
        <dt className="text-muted">Thought</dt>
        <dd>{d.proj.toFixed(1)}</dd>
        <dt className="text-muted">Scored</dt>
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
      <p className="font-medium">Last-week weight {d.alpha.toFixed(2)}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
        <dt className="text-muted">Team score</dt>
        <dd>{d.lineupMean.toFixed(1)}</dd>
        <dt className="text-muted">Miss / player</dt>
        <dd>{d.mae.toFixed(2)}</dd>
        <dt className="text-muted">Season avg</dt>
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
