import { useEffect } from "react";

/** One light source for every glass panel — follows scroll and pointer, like iOS. */
export function GlassLight() {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const paint = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const t = window.scrollY / max;
      root.style.setProperty("--light-y", `${12 + t * 68}%`);
      root.style.setProperty("--light-x", `${20 + t * 28}%`);
      if (reduced) root.style.setProperty("--spec-y", `${8 + t * 30}%`);
    };

    const onMove = (e: PointerEvent) => {
      if (reduced) return;
      root.style.setProperty("--spec-x", `${(e.clientX / window.innerWidth) * 100}%`);
      root.style.setProperty("--spec-y", `${(e.clientY / window.innerHeight) * 70}%`);
      root.style.setProperty("--light-x", `${(e.clientX / window.innerWidth) * 100}%`);
    };

    paint();
    window.addEventListener("scroll", paint, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("scroll", paint);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return <div className="atmosphere" aria-hidden />;
}
