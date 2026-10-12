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
        "rounded-[14px] bg-panel p-4 text-sm leading-relaxed text-muted",
        className,
      )}
    >
      <p className="mb-1.5 text-sm font-semibold text-fg">
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </aside>
  );
}
