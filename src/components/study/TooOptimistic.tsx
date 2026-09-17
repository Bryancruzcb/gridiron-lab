import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { StudyRunSummary } from "@/data/types";
import {
  COMPUTER,
  axisProps,
  CHART,
  computerWeeks,
  fix,
  guessHigh,
  mean,
  model,
  signed,
  ticks,
  type View,
} from "./shared";
import { GuessTip } from "./tips";
import { ViewPickerLabel } from "./ViewPicker";

export function TooOptimistic({ view, summary, label }: { view: View; summary: StudyRunSummary; label: string }) {
  const computer = model(summary, COMPUTER);
  const dots = view.row.weekly.map((w) => ({ week: w.week, proj: w.lineups[COMPUTER]!.proj, actual: w.lineups[COMPUTER]!.actual }));
  const under = dots.filter((d) => d.actual < d.proj).length;
  const values = dots.flatMap((d) => [d.proj, d.actual]);
  const lo = Math.floor(Math.min(...values) / 25) * 25;
  const hi = Math.ceil(Math.max(...values) / 25) * 25;
  const every = guessHigh === computerWeeks.length;

  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl uppercase tracking-[0.04em]">The computer was too optimistic</h2>
      <p className="mt-3 text-sm leading-relaxed">
        Before kickoff the computer expected its team to score about{" "}
        {fix(computer.lineupProjMean ?? Number.NaN, 0)} ({label}). It actually scored about{" "}
        {fix(mean(computer), 0)}. Its guess was too high in {guessHigh} of {computerWeeks.length} weeks
        {every ? ", every single one" : ""}. The guesses were not high player by player: over{" "}
        {computer.playerError.n.toLocaleString("en-US")} player-weeks the average miss was{" "}
        {signed(computer.playerError.bias ?? Number.NaN, 2)} points. The team guess runs high because
        the computer hunts for the players whose averages ran hottest so far, and hot streaks cool
        off. The old solver did have a bug (see below), but the fixed one proves its teams are the
        best for the guesses and still overshoots, so the bug was not the reason.
      </p>
      <ViewPickerLabel view={view} />
      <div className="mt-3 h-[240px] rounded-xl bg-surface p-3 shadow-[var(--shadow-border)] sm:p-4">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 12, bottom: 8, left: 4 }}>
            <CartesianGrid stroke={CHART.grid} />
            <XAxis
              type="number"
              dataKey="proj"
              name="Guess"
              domain={[lo, hi]}
              ticks={ticks(lo, hi, 25)}
              {...axisProps}
              tick={{ fill: "#C5CCD6", fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="actual"
              name="Real"
              domain={[lo, hi]}
              width={36}
              ticks={ticks(lo, hi, 25)}
              {...axisProps}
              tick={{ fill: "#C5CCD6", fontSize: 11 }}
            />
            <ReferenceLine
              segment={[
                { x: lo, y: lo },
                { x: hi, y: hi },
              ]}
              stroke={CHART.muted}
              strokeDasharray="4 4"
            />
            <Tooltip content={<GuessTip />} />
            <Scatter data={dots} fill={CHART.paper} />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-muted">
        Each dot is a week. Perfect guesses would sit on the dashed line. {under} of {dots.length} dots
        are under it{under === dots.length ? ": the computer always thought it would score more than it did" : ""}.
      </p>
    </section>
  );
}
