let backdropUrl: boolean | null = null;
let glOk: boolean | null = null;

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Chromium mostly. Safari often lies or no-ops url() on backdrop-filter. */
export function supportsBackdropUrl(): boolean {
  if (backdropUrl != null) return backdropUrl;
  if (typeof CSS === "undefined" || !CSS.supports) {
    backdropUrl = false;
    return false;
  }
  backdropUrl =
    CSS.supports("backdrop-filter", "url(#lg-x) blur(1px)") ||
    CSS.supports("-webkit-backdrop-filter", "url(#lg-x) blur(1px)");
  return backdropUrl;
}

export function supportsWebGL(): boolean {
  if (glOk != null) return glOk;
  if (typeof document === "undefined") {
    glOk = false;
    return false;
  }
  try {
    const c = document.createElement("canvas");
    glOk = Boolean(c.getContext("webgl") || c.getContext("experimental-webgl"));
  } catch {
    glOk = false;
  }
  return glOk;
}
