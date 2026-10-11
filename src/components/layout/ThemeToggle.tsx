import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { applyTheme, nextTheme, readStoredTheme, resolveTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Sun/moon button in the header. The theme is a cell: the system setting and the viewer's pick feed it. */
export function ThemeToggle({ className }: { className?: string }) {
  // null until the browser tells us; the icons below follow the CSS theme, so nothing flashes.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(DARK_QUERY);
    const sync = () => setTheme(resolveTheme(readStoredTheme(), mq.matches));
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const label = theme === "dark" ? "Switch to light theme" : theme === "light" ? "Switch to dark theme" : "Switch color theme";

  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        const current = theme ?? resolveTheme(readStoredTheme(), window.matchMedia(DARK_QUERY).matches);
        const next = nextTheme(current);
        applyTheme(next);
        setTheme(next);
      }}
      className={cn(
        "hit-shine grid size-10 shrink-0 place-items-center rounded-full bg-surface text-fg shadow-[var(--shadow-border)] hover:shadow-[var(--shadow-border-hover)]",
        className,
      )}
    >
      <Sun className="theme-icon-light size-[18px]" aria-hidden />
      <Moon className="theme-icon-dark size-[18px]" aria-hidden />
    </button>
  );
}
