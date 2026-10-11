import type { ReactNode } from "react";
import { useMounted } from "@/lib/use-mounted";
import { cn } from "@/lib/utils";

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-sm font-semibold text-muted", className)}>{children}</p>;
}

export function SectionTitle({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mt-2 max-w-[22em] font-display text-[clamp(30px,3.4vw,42px)] leading-[1.1]">
      {children}
    </h2>
  );
}

/** A full-width study section with the hairline rule above it. */
export function Block({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-20 border-t border-border py-12 sm:py-16", className)}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">{children}</div>
    </section>
  );
}

/** Small pill label. Always carries text, so color is never the only signal. */
export function Tag({
  tone = "plain",
  icon,
  children,
}: {
  tone?: "good" | "plain" | "look";
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 align-middle font-sans text-xs font-semibold whitespace-nowrap [&_svg]:size-3.5",
        tone === "good" && "bg-sage-soft text-sage",
        tone === "plain" && "bg-track text-muted",
        tone === "look" && "bg-warn-soft text-warn",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** A table on a white card that scrolls sideways inside itself on narrow screens. */
export function TableCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("table-scroll rounded-[18px] bg-surface shadow-[var(--shadow-border)]", className)}>{children}</div>;
}


/**
 * A chart card. Recharts measures its box in the browser, so until then a skeleton of the same
 * height holds the space (no layout shift, no blank box).
 */
export function ChartFrame({
  height,
  label,
  children,
  className,
}: {
  height: number;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const mounted = useMounted();
  return (
    <div className={cn("rounded-[18px] bg-surface p-3 shadow-[var(--shadow-border)] sm:p-4", className)}>
      <div role="img" aria-label={label} style={{ height }}>
        {mounted ? children : <div className="skeleton h-full w-full" />}
      </div>
    </div>
  );
}

export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mt-2.5 text-sm leading-relaxed text-muted", className)}>{children}</p>;
}
