import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import type { StudyRunSummary } from "@/data/types";
import { Caption, ChartFrame, TableCard } from "./parts";
import { td, tdR, th, thR } from "./table";
import {
  COMPUTER,
  TOP_NAMES,
  axisProps,
  CHART,
  cn,
  computerWeeks,
  fix,
  guessHigh,
  mean,
  model,
  ticks,
  type View,
} from "./shared";
import { GuessTip } from "./tips";
import { ViewPicker } from "./ViewPicker";

/** Archive: the team guess ran high every week, with the week-by-week lineup scores for one season. */
export function TooOptimistic({
  view,
  setViewKey,
  summary,
  label,
}: {
  view: View;
  setViewKey: (key: string) => void;
  summary: StudyRunSummary;
  label: string;
}) {
  const computer = model(summary, COMPUTER);
  const dots = view.row.weekly.map((w) => ({ week: w.week, proj: w.lineups[COMPUTER]!.proj, actual: w.lineups[COMPUTER]!.actual }));
  const under = dots.filter((d) => d.actual < d.proj).length;
  const values = dots.flatMap((d) => [d.proj, d.actual]);
  const lo = Math.floor(Math.min(...values) / 25) * 25;
  const hi = Math.ceil(Math.max(...values) / 25) * 25;
  const every = guessHigh === computerWeeks.length;
  const weekly = view.row.weekly;
  const vs = view.row.summary;
  const wins = weekly.filter((w) => w.lineups[COMPUTER]!.actual > w.lineups[TOP_NAMES]!.actual).length;

  return (
    <>
      <h3 className="mt-9 font-display text-[26px] leading-[1.15]">The team guess ran hot</h3>
      <div className="mt-3 grid items-start gap-10 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="text-base">
            Before kickoff the computer expected its team to score about {fix(computer.lineupProjMean ?? Number.NaN, 0)}{" "}
            ({label}). It actually scored about {fix(mean(computer), 0)}. Its guess was too high in {guessHigh} of{" "}
            {computerWeeks.length} weeks
            {every ? ", every single one" : ""}. The guesses were not high player by player (see the bias above). The team guess runs high because the computer
            hunts for the players whose averages ran hottest so far, and hot streaks cool off. The old solver did have a
            bug (see What went wrong), but the fixed one proves its teams are the best for the guesses and still
            overshoots, so the bug was not the reason.
          </p>
          <ViewPicker viewKey={view.key} setViewKey={setViewKey} />
          <figure className="m-0 mt-4">
            <ChartFrame
              height={260}
              label={`Scatter of each week's team guess against the real team score for ${view.label}, with a dashed line for perfect guesses.`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 12, bottom: 22, left: 4 }}>
                  <CartesianGrid stroke={CHART.grid} />
                  <XAxis
                    type="number"
                    dataKey="proj"
                    name="Guess"
                    domain={[lo, hi]}
                    ticks={ticks(lo, hi, 25)}
                    {...axisProps}
                    label={{ value: "Team guess before kickoff", position: "insideBottom", offset: -14, fill: CHART.muted, fontSize: 12 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="actual"
                    name="Real"
                    domain={[lo, hi]}
                    width={48}
                    ticks={ticks(lo, hi, 25)}
                    {...axisProps}
                    label={{ value: "Real points", angle: -90, position: "insideLeft", offset: 4, fill: CHART.muted, fontSize: 12, style: { textAnchor: "middle" } }}
                  />
                  <ReferenceLine
                    segment={[
                      { x: lo, y: lo },
                      { x: hi, y: hi },
                    ]}
                    stroke={CHART.muted}
                    strokeDasharray="4 4"
                  />
                  <Tooltip cursor={{ stroke: CHART.muted, strokeDasharray: "3 3" }} content={<GuessTip />} />
                  <Scatter data={dots} fill={CHART.paper} />
                </ScatterChart>
              </ResponsiveContainer>
            </ChartFrame>
            <figcaption>
              <Caption>
                {view.label} ({view.note}). Each dot is a week; the dashed line is a perfect guess. {under} of{" "}
                {dots.length} weeks fell under it.
              </Caption>
            </figcaption>
          </figure>
        </div>
        <div className="min-w-0">
          <TableCard>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={cn(th, "py-1.5")}>Week</th>
                  <th className={cn(thR, "py-1.5")}>Computer</th>
                  <th className={cn(thR, "py-1.5")}>Top names</th>
                </tr>
              </thead>
              <tbody>
                {weekly.map((w) => {
                  const c = w.lineups[COMPUTER]!.actual;
                  const t = w.lineups[TOP_NAMES]!.actual;
                  return (
                    <tr key={w.week}>
                      <td className={cn(td, "py-1.5 tabular-nums")}>{w.week}</td>
                      <td className={cn(tdR, "py-1.5", c > t && "font-semibold text-sage")}>
                        {fix(c, 1)}
                        {c > t ? " (won)" : ""}
                      </td>
                      <td className={cn(tdR, "py-1.5")}>{fix(t, 1)}</td>
                    </tr>
                  );
                })}
                <tr className="font-semibold">
                  <td className="px-3 py-2">Mean</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fix(mean(model(vs, COMPUTER)), 1)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fix(mean(model(vs, TOP_NAMES)), 1)}</td>
                </tr>
              </tbody>
            </table>
          </TableCard>
          <Caption>
            {view.label}: the computer beat the top-names pick in {wins} of {weekly.length} weeks.
          </Caption>
        </div>
      </div>
    </>
  );
}
