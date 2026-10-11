import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { Block, Caption, ChartFrame, Eyebrow, SectionTitle } from "./parts";
import { axisProps, CHART, lag, study } from "./shared";
import { LagTip } from "./tips";

/** Question 2: does last week's QB efficiency predict this week's? */
export function HotQbs() {
  const others = study.seasons.filter((s) => s.qbLag && s.season !== lag.season);
  return (
    <Block id="qb">
      <Eyebrow>Question 2</Eyebrow>
      <SectionTitle>Do hot quarterbacks stay hot? Barely.</SectionTitle>
      <div className="mt-8 grid items-start gap-10 lg:grid-cols-2">
        <div className="min-w-0 space-y-3 text-base">
          <p>
            <b className="font-semibold">Almost no.</b> In {lag.season}, last week’s EPA per throw barely lines up with
            this week’s (r = {lag.corrEpa ?? "—"}, {lag.n} QB-weeks with {lag.minAttempts}+ throws). CPOE is the same
            story (r = {lag.corrCpoe ?? "—"}).
          </p>
          {others.length ? (
            <p>
              Other seasons agree:{" "}
              {others
                .map(
                  (s) =>
                    `${s.season} r = ${s.qbLag!.corrEpa ?? "—"} for EPA and ${s.qbLag!.corrCpoe ?? "—"} for CPOE (${s.qbLag!.n} QB-weeks)`,
                )
                .join("; ")}
              .
            </p>
          ) : null}
          <p className="text-muted">
            An r near 0 means no link and 1 means a perfect one. The QB page is a report card on what already
            happened. It is not a crystal ball for next Sunday.
          </p>
        </div>
        <figure className="m-0 min-w-0">
          <ChartFrame
            height={300}
            label={`Scatter of ${lag.season} quarterback weeks: last week's EPA per throw against this week's. The points form a loose cloud, not a diagonal.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 12, bottom: 22, left: 4 }}>
                <CartesianGrid stroke={CHART.grid} />
                <XAxis
                  type="number"
                  dataKey="epaPrev"
                  name="Last week"
                  tickCount={5}
                  {...axisProps}
                  tickFormatter={(v: number) => v.toFixed(1)}
                  label={{ value: "Last week’s EPA per throw", position: "insideBottom", offset: -14, fill: CHART.muted, fontSize: 12 }}
                />
                <YAxis
                  type="number"
                  dataKey="epaNext"
                  name="This week"
                  width={44}
                  tickCount={5}
                  {...axisProps}
                  tickFormatter={(v: number) => v.toFixed(1)}
                  label={{ value: "This week", angle: -90, position: "insideLeft", offset: 6, fill: CHART.muted, fontSize: 12, style: { textAnchor: "middle" } }}
                />
                <Tooltip cursor={{ strokeDasharray: "3 3", stroke: CHART.muted }} content={<LagTip />} />
                <Scatter data={lag.pairs} fill={CHART.paper} fillOpacity={0.45} />
              </ScatterChart>
            </ResponsiveContainer>
          </ChartFrame>
          <figcaption>
            <Caption>
              {lag.season}. Across = last week’s EPA per throw. Up = this week. A tight diagonal would mean last week
              predicts this week. This is a cloud.
            </Caption>
          </figcaption>
        </figure>
      </div>
    </Block>
  );
}
