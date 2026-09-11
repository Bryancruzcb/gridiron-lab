import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MethodNote({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "rounded-lg bg-elevated/80 p-4 text-sm leading-relaxed text-muted shadow-[var(--shadow-border)]",
        className,
      )}
    >
      <p className="mb-1.5 text-[11px] font-medium tracking-[0.16em] text-subtle uppercase">
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </aside>
  );
}
