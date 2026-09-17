import { Headshot } from "@/components/Headshot";
import type { QbSeason } from "@/data/types";
import { teamNick } from "@/lib/nfl";
import { isThin } from "@/lib/season";
import { cn, formatEpa } from "@/lib/utils";

type WeekPoint = NonNullable<QbSeason["weeks"]>[number];

/** One week's EPA per dropback as bars either side of zero, busiest quarterback first. */
export function WeekBars({ qbs, week }: { qbs: readonly QbSeason[]; week: number }) {
  const lines = qbs
    .map((qb) => ({ qb, pt: qb.weeks?.find((w) => w.week === week) }))
    .filter((l): l is { qb: QbSeason; pt: WeekPoint } => l.pt !== undefined)
    .sort((a, b) => b.pt.plays - a.pt.plays);
  const scale = Math.max(0.5, Math.ceil(Math.max(0, ...lines.map((l) => Math.abs(l.pt.epa ?? 0))) * 10) / 10);
  const grid = "sm:grid-cols-[minmax(160px,220px)_minmax(0,1fr)_128px] sm:[grid-template-areas:'who_bar_val']";
  return (
    <div className="mt-4">
      <div aria-hidden className={cn("grid gap-x-5 pb-2", grid)}>
        <div className="flex justify-between text-xs text-subtle tabular-nums sm:[grid-area:bar]">
          <span>{formatEpa(-scale, 1)}</span>
          <span>0</span>
          <span>{formatEpa(scale, 1)}</span>
        </div>
      </div>
      <ol>
        {lines.map(({ qb, pt }) => {
          const epa = pt.epa ?? 0;
          const up = epa >= 0;
          const thin = isThin(pt.plays);
          return (
            <li
              key={qb.id}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 border-t border-border/70 py-2.5 [grid-template-areas:'who_val'_'bar_bar']",
                grid,
              )}
            >
              <div className="flex min-w-0 items-center gap-3 [grid-area:who]">
                <Headshot src={qb.headshot} name={qb.name} team={qb.team} className="size-10" />
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold">{qb.name}</p>
                  <p className="text-[13px] text-muted">{teamNick(qb.team)}</p>
                </div>
              </div>
              <div
                role="img"
                aria-label={`${qb.name}: ${formatEpa(pt.epa)} EPA per dropback in week ${week}`}
                className="relative h-3.5 rounded-full bg-fg/[0.06] [grid-area:bar]"
              >
                <span aria-hidden className="absolute -top-1.5 -bottom-1.5 left-1/2 w-px bg-fg/40" />
                <span
                  aria-hidden
                  className={cn("absolute inset-y-0", up ? "left-1/2 rounded-r-full bg-up" : "right-1/2 rounded-l-full bg-down")}
                  style={{ width: `${Math.min(50, (Math.abs(epa) / scale) * 50)}%` }}
                />
              </div>
              <div className="text-right leading-tight [grid-area:val]">
                <p className={cn("text-xl font-bold tabular-nums", up ? "text-up" : "text-down")}>{formatEpa(pt.epa)}</p>
                <p className="text-[13px] text-muted">
                  {pt.plays} dropback{pt.plays === 1 ? "" : "s"}
                </p>
                {thin && <p className="text-xs text-subtle">small sample</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
