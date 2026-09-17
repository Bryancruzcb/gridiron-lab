import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { axisProps, CHART, lag, study } from "./shared";
import { LagTip } from "./tips";

export function HotQbs() {
  const others = study.seasons.filter((s) => s.qbLag && s.season !== lag.season);
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl uppercase tracking-[0.04em]">Do hot QBs stay hot?</h2>
      <p className="mt-3 text-sm leading-relaxed">
        Almost no. In {lag.season}, last week’s EPA barely lines up with this week’s (r ={" "}
        {lag.corrEpa ?? "—"}, {lag.n} QB-weeks with {lag.minAttempts}+ throws). CPOE is the same story (r ={" "}
        {lag.corrCpoe ?? "—"}).
        {others.length
          ? ` Other seasons agree: ${others.map((s) => `${s.season} r = ${s.qbLag!.corrEpa ?? "—"} for EPA and ${s.qbLag!.corrCpoe ?? "—"} for CPOE (${s.qbLag!.n} QB-weeks)`).join("; ")}.`
          : ""}{" "}
        The QB page is a report card on what already happened. It is not a crystal ball for next
        Sunday.
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
        {lag.season}. Left = last week’s EPA per throw. Up = this week. A tight diagonal would mean
        last week predicts this week. This is a cloud.
      </p>
    </section>
  );
}
