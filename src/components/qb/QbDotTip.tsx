import { teamNick } from "@/lib/nfl";
import { isThin } from "@/lib/season";
import { cn, formatCpoe, formatEpa } from "@/lib/utils";

export function QbDotTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload: { name: string; team: string; epa: number; cpoe: number; plays: number };
  }>;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md bg-elevated px-3.5 py-3 text-fg shadow-[var(--shadow-border-hover)]">
      <p className="text-base font-semibold">{d.name}</p>
      <p className="text-[13px] text-muted">{teamNick(d.team)}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm tabular-nums">
        <dt className="text-muted">EPA / dropback</dt>
        <dd className={cn("text-right font-semibold", d.epa >= 0 ? "text-up" : "text-down")}>{formatEpa(d.epa)}</dd>
        <dt className="text-muted">CPOE</dt>
        <dd className="text-right font-semibold">{formatCpoe(d.cpoe)}</dd>
        <dt className="text-muted">Dropbacks</dt>
        <dd className="text-right font-semibold">
          {d.plays}
          {isThin(d.plays) ? " · small sample" : ""}
        </dd>
      </dl>
    </div>
  );
}
