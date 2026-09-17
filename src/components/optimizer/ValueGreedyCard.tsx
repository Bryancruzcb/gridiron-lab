import { cn } from "@/lib/utils";

/** Small sidebar card for the pts/$ greedy alternate when it differs from the best. */
export function ValueGreedyCard({
  proj,
  isCurrent,
}: {
  proj: number;
  isCurrent: boolean;
}) {
  return (
    <div className={cn("rounded-xl bg-surface p-5 shadow-[var(--shadow-border)]", !isCurrent && "opacity-60")}>
      <h2 className="font-display text-lg uppercase tracking-[0.06em]">Value greedy</h2>
      <p className="mt-2 font-mono text-sm">{proj.toFixed(1)} pts</p>
      <p className="mt-1 text-xs text-muted">Pts/$ greedy on the same constraints · heuristic</p>
    </div>
  );
}
