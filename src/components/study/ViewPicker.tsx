import { cn, views } from "./shared";

/** Season pills for the archive's week-by-week views. */
export function ViewPicker({ viewKey, setViewKey }: { viewKey: string; setViewKey: (key: string) => void }) {
  return (
    <div className="mt-4 flex flex-wrap gap-1.5" role="group" aria-label="Season for the week-by-week views">
      {views.map((v) => (
        <button
          key={v.key}
          type="button"
          aria-pressed={v.key === viewKey}
          onClick={() => setViewKey(v.key)}
          className={cn(
            "min-h-9 rounded-full px-3.5 text-sm font-medium",
            v.key === viewKey ? "bg-fg text-bg" : "text-muted shadow-[var(--shadow-border)] hover:text-fg",
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
