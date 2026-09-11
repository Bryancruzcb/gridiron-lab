import type { CSSProperties } from "react";
import { CHART } from "@/lib/nfl";

export const tooltipStyle: CSSProperties = {
  background: CHART.tooltipBg,
  border: `1px solid ${CHART.tooltipBorder}`,
  borderRadius: 8,
  fontSize: 12,
  color: CHART.fg,
};

export const axisProps = {
  stroke: CHART.axis,
  tick: { fill: CHART.tick, fontSize: 11 },
  tickLine: false as const,
};

export { CHART };
