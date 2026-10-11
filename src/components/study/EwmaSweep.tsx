import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Caption, ChartFrame } from "./parts";
import { axisProps, CHART, ewma, fix, ticks } from "./shared";
import { AlphaTip } from "./tips";

function ewmaDomain(): [number, number] {
  const ys = [...ewma.points.map((p) => p.lineupMean), ewma.trail.lineupMean];
  return [Math.floor(Math.min(...ys) / 5) * 5, Math.ceil(Math.max(...ys) / 5) * 5];
}

/** Archive: the last-week weight sweep on the shipped slate (exploratory). */
export function EwmaSweep() {
  let step = 0;
  for (let i = 1; i < ewma.points.length; i++) {
    step = Math.max(step, Math.abs(ewma.points[i]!.lineupMean - ewma.points[i - 1]!.lineupMean));
  }
  const domain = ewmaDomain();
  return (
    <>
      <h3 className="mt-9 font-display text-[26px] leading-[1.15]">How much to trust last week</h3>
      <div className="mt-8 grid items-start gap-10 lg:grid-cols-2">
        <div className="min-w-0 space-y-3 text-base">
          <p>
            Far left = mostly the season so far. Far right = only last week. The dashed line is “just use their average
            so far.”
          </p>
          <p>
            This sweep runs on the shipped {ewma.season} slate, after we had already studied {ewma.season}, so it is a
            look back, not a result. The best-looking setting was {ewma.bestLineup.alpha} ({ewma.bestLineup.lineupMean})
            against {ewma.trail.lineupMean} for the average. Neighbouring settings differ by up to {fix(step, 1)} points.{" "}
            {ewma.trail.weeks} weeks is too few to treat the peak as a discovery.
          </p>
        </div>
        <figure className="m-0 min-w-0">
          <ChartFrame
            height={250}
            label="Line chart of the team's real points against the weight on last week, with a dashed line for the season average so far."
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={ewma.points} margin={{ top: 8, right: 12, bottom: 22, left: 0 }}>
                <CartesianGrid stroke={CHART.grid} />
                <XAxis
                  dataKey="alpha"
                  type="number"
                  domain={[0, 1]}
                  ticks={[0.2, 0.4, 0.6, 0.8, 1]}
                  {...axisProps}
                  label={{ value: "Weight on last week (α)", position: "insideBottom", offset: -14, fill: CHART.muted, fontSize: 12 }}
                />
                <YAxis domain={domain} ticks={ticks(...domain, 5)} width={40} {...axisProps} />
                <ReferenceLine y={ewma.trail.lineupMean} stroke={CHART.muted} strokeDasharray="4 4" />
                <Tooltip cursor={{ stroke: CHART.muted, strokeDasharray: "3 3" }} content={<AlphaTip trail={ewma.trail.lineupMean} />} />
                <Line
                  type="linear"
                  dataKey="lineupMean"
                  stroke={CHART.paper}
                  strokeWidth={2}
                  dot={{ r: 3, fill: CHART.paper, stroke: CHART.paper }}
                  activeDot={{ r: 5, fill: CHART.sage, stroke: CHART.sage }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartFrame>
          <figcaption>
            <Caption>
              Shipped {ewma.season} slate. Team’s real points against how hard we weight last week. Dashed = season
              average so far ({ewma.trail.lineupMean}).
            </Caption>
          </figcaption>
        </figure>
      </div>
    </>
  );
}
