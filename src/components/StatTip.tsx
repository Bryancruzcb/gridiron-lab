import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { METRICS, type MetricId } from "@/lib/metrics";
import { cn } from "@/lib/utils";

export function StatTip({
  metric,
  children,
  className,
}: {
  metric: MetricId;
  children?: ReactNode;
  className?: string;
}) {
  const m = METRICS[metric];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "cursor-help border-b border-dotted border-subtle/80 text-inherit",
            className,
          )}
        >
          {children ?? m.label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] leading-relaxed">
        <p className="mb-1 font-medium tracking-wide uppercase">{m.label}</p>
        <p className="text-muted">{m.def}</p>
      </TooltipContent>
    </Tooltip>
  );
}
