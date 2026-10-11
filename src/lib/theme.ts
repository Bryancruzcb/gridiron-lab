// Light/dark theme. The page follows the system until the viewer picks one with the header toggle;
// the pick is kept in this browser only (a per-viewer convenience) and set on <html data-theme>.

export type Theme = "light" | "dark";

export const THEME_KEY = "gridiron-theme";

/** Calculation: the stored pick wins, else the system setting. */
export function resolveTheme(stored: string | null, systemDark: boolean): Theme {
  if (stored === "light" || stored === "dark") return stored;
  return systemDark ? "dark" : "light";
}

export function nextTheme(t: Theme): Theme {
  return t === "dark" ? "light" : "dark";
}

/**
 * Runs in <head> before the first paint, so a stored pick never flashes the other theme.
 * Kept tiny and dependency-free; it mirrors resolveTheme for the stored case only.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

/** Action: read the stored pick (storage can be blocked, so failures read as "no pick"). */
export function readStoredTheme(): string | null {
  try {
    return window.localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

/** Action: apply a pick to the page and remember it. */
export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute("data-theme", t);
  try {
    window.localStorage.setItem(THEME_KEY, t);
  } catch {
    // Storage blocked: the pick still applies for this page view.
  }
}
