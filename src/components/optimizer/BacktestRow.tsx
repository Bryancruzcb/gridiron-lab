import { scoreLineup, type SolveResult } from "@/lib/optimizer";
import { cn } from "@/lib/utils";
import { METHOD } from "./helpers";

export function BacktestRow({
  label,
  result,
  actuals,
  hindsight = false,
}: {
  label: string;
  result: SolveResult;
  actuals: ReadonlyMap<string, number>;
  hindsight?: boolean;
}) {
  const lineup = result.status === "ok" ? result.lineup : null;
  const score = lineup && !hindsight ? scoreLineup(lineup.players, actuals) : null;
  const title = result.status === "ok" ? `${METHOD[result.method]}, ${result.optimality}` : result.message;
  return (
    <tr className="border-t border-border/70" title={title}>
      <td className="py-1.5">{label}</td>
      <td className={cn("py-1.5 text-right", hindsight && "text-muted")}>{lineup && !hindsight ? lineup.proj.toFixed(1) : "—"}</td>
      <td className="py-1.5 text-right">
        {!lineup ? "—" : hindsight ? lineup.proj.toFixed(1) : `${score!.pts.toFixed(1)}${score!.missing.length ? "*" : ""}`}
      </td>
    </tr>
  );
}
