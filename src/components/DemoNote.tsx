import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The $50k-lineup disclaimer. It stays visible at the top of the homepage and the Lineup page. */
export function DemoNote({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <p className={cn("flex max-w-[34em] items-start gap-2.5 text-sm text-muted", className)}>
      <Info className="mt-0.5 size-[18px] shrink-0 text-navy" aria-hidden />
      <span>
        <b className="font-semibold text-fg">The $50k lineup is a demo with synthetic salaries.</b>{" "}
        {children ?? "It is not part of this result."}
      </span>
    </p>
  );
}
