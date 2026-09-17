import { cn, views } from "./shared";

export function ViewPicker({ viewKey, setViewKey }: { viewKey: string; setViewKey: (key: string) => void }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Season">
      {views.map((v) => (
        <button
          key={v.key}
          type="button"
          aria-pressed={v.key === viewKey}
          onClick={() => setViewKey(v.key)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs uppercase tracking-[0.08em] shadow-[var(--shadow-border)] transition-colors",
            v.key === viewKey ? "bg-elevated text-fg" : "text-muted hover:text-fg",
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

export function ViewPickerLabel({ view }: { view: { label: string } }) {
  return (
    <p className="mt-4 text-xs text-muted">
      Showing {view.label}. Pick a season in the week-by-week table above.
    </p>
  );
}
