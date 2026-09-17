import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { axisProps, CHART, ewma, fix, ticks } from "./shared";
import { AlphaTip } from "./tips";

export function ewmaDomain(): [number, number] {
  const ys = [...ewma.points.map((p) => p.lineupMean), ewma.trail.lineupMean];
  return [Math.floor(Math.min(...ys) / 5) * 5, Math.ceil(Math.max(...ys) / 5) * 5];
}

export function EwmaText() {
  let step = 0;
  for (let i = 1; i < ewma.points.length; i++) {
    step = Math.max(step, Math.abs(ewma.points[i]!.lineupMean - ewma.points[i - 1]!.lineupMean));
  }
  return (
    <p className="mt-3 text-sm leading-relaxed">
      Far left = mostly the season so far. Far right = only last week. The dashed line is “just use
      their average so far.” This sweep runs on the shipped {ewma.season} slate, after we had already
      studied {ewma.season}, so it is a look back, not a result. The best-looking setting was{" "}
      {ewma.bestLineup.alpha} ({ewma.bestLineup.lineupMean}) against {ewma.trail.lineupMean} for the
      average. Neighbouring settings differ by up to {fix(step, 1)} points. {ewma.trail.weeks} weeks is
      too few to treat the peak as a discovery.
    </p>
  );
}

/** Last-week weight sweep chart + copy (Study “How much to trust last week”). */
export function EwmaSweep() {
  return (
    <section className="mt-10">
      <h2 className="font-display text-2xl uppercase tracking-[0.04em]">How much to trust last week</h2>
      <EwmaText />
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
              domain={ewmaDomain()}
              ticks={ticks(...ewmaDomain(), 5)}
              width={36}
              {...axisProps}
              tick={{ fill: "#C5CCD6", fontSize: 11 }}
            />
            <ReferenceLine y={ewma.trail.lineupMean} stroke={CHART.muted} strokeDasharray="4 4" />
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
        Shipped {ewma.season} slate. Team’s real points vs how hard we weight last week. Dashed
        = season average so far ({ewma.trail.lineupMean}).
      </p>
    </section>
  );
}
