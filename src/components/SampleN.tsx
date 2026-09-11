import { cn } from "@/lib/utils";
import { THIN_N, isThin } from "@/lib/season";

export function SampleN({ n, className }: { n: number; className?: string }) {
  if (!n) return <span className={cn("font-mono text-xs text-muted tabular-nums", className)}>—</span>;
  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums",
        isThin(n) ? "text-muted" : "text-fg",
        className,
      )}
      title={isThin(n) ? `Small sample (under ${THIN_N})` : `${n} plays`}
    >
      n={n}
    </span>
  );
}
