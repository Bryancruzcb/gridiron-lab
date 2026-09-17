import type { ReactNode } from "react";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold tracking-[0.12em] text-muted uppercase">{label}</span>
      {children}
    </div>
  );
}
