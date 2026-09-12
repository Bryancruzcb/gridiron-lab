import { cn } from "@/lib/utils";
import { THIN_N, isThin } from "@/lib/season";

function unitWord(n: number, unit: string) {
  if (n === 1) {
    if (unit.endsWith("ies")) return `${unit.slice(0, -3)}y`;
    if (unit.endsWith("s") && !unit.endsWith("ss")) return unit.slice(0, -1);
  }
  return unit;
}

/** Count plus unit, e.g. "36 dropbacks" — not "n=36". */
export function SampleN({
  n,
  unit = "plays",
  className,
}: {
  n: number;
  unit?: string;
  className?: string;
}) {
  if (!n) return <span className={cn("font-mono text-xs text-muted tabular-nums", className)}>—</span>;
  const label = `${n} ${unitWord(n, unit)}`;
  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums",
        isThin(n) ? "text-muted" : "text-fg",
        className,
      )}
      title={isThin(n) ? `${label} · small sample (under ${THIN_N})` : label}
    >
      {label}
    </span>
  );
}
