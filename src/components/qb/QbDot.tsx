import { CHART } from "@/components/charts/theme";
import { formatEpa } from "@/lib/utils";
import { DOWN, INK_QUIET, UP, type ScatterPoint } from "./chart";

/** A quarterback on the scatter: a photo (pinned, or when the slice is small) or a dot, with an optional name. */
export function QbDot(props: unknown) {
  const { cx, cy, payload: d } = props as { cx?: number; cy?: number; payload?: ScatterPoint };
  if (cx == null || cy == null || !d) return <g />;
  const clip = `qb-dot-${d.id}`;
  const labelX = d.flip ? cx - d.r - 8 : cx + d.r + 8;
  return (
    <g className="cursor-pointer" opacity={d.pinned || !d.photo ? 1 : 0.6}>
      <circle cx={cx} cy={cy} r={d.r + 8} fill="transparent" />
      {d.photo && d.headshot ? (
        <>
          <defs>
            <clipPath id={clip}>
              <circle cx={cx} cy={cy} r={d.r} />
            </clipPath>
          </defs>
          <circle cx={cx} cy={cy} r={d.r + 2} fill={d.pinned ? CHART.fg : INK_QUIET} />
          <circle cx={cx} cy={cy} r={d.r} fill="#1A1D24" />
          <image
            href={d.headshot}
            x={cx - d.r}
            y={cy - d.r}
            width={d.r * 2}
            height={d.r * 2}
            clipPath={`url(#${clip})`}
            preserveAspectRatio="xMidYMin slice"
          />
        </>
      ) : (
        <circle
          cx={cx}
          cy={cy}
          r={d.r}
          fill={d.pinned ? CHART.fg : "#0A0B0D"}
          stroke={d.pinned ? "#0A0B0D" : INK_QUIET}
          strokeWidth={2}
        />
      )}
      {d.label && (
        <text
          x={labelX}
          y={cy + 5}
          textAnchor={d.flip ? "end" : "start"}
          fontSize={14}
          fontWeight={700}
          fill={d.pinned ? CHART.fg : INK_QUIET}
        >
          {d.last}{" "}
          <tspan fontWeight={600} fill={d.epa >= 0 ? UP : DOWN}>
            {formatEpa(d.epa)}
          </tspan>
        </text>
      )}
    </g>
  );
}
