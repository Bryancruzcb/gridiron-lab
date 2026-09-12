import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { hasSeen, markSeen } from "@/lib/first-look";

export function FirstLook({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(!hasSeen(id));
  }, [id]);

  if (!open) return null;

  return (
    <aside className="mt-6 rounded-xl bg-elevated p-4 shadow-[var(--shadow-border)] sm:p-5">
      <p className="font-display text-xl uppercase tracking-[0.04em]">{title}</p>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-fg/90">{children}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => {
            markSeen(id);
            setOpen(false);
          }}
        >
          Got it
        </Button>
        <Button asChild variant="outline">
          <Link to="/guide">Open guide</Link>
        </Button>
      </div>
    </aside>
  );
}
