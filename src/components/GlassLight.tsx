import { useEffect, useRef } from "react";
import { setRimLight } from "@/lib/glass/rim";

/** One light source for every glass panel — follows scroll and pointer, like iOS. */
export function GlassLight() {
  const atmoRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const atmo = atmoRef.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const emit = () => root.dispatchEvent(new Event("glasslight"));

    let rafId = 0;
    const paint = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        const t = window.scrollY / max;
        if (atmo) {
          atmo.style.setProperty("--light-y", `${12 + t * 68}%`);
          atmo.style.setProperty("--light-x", `${20 + t * 28}%`);
        }
      });
    };

    let moveRafId = 0;
    const onMove = (e: PointerEvent) => {
      if (reduced) return;
      const lx = e.clientX / window.innerWidth;
      const ly = (e.clientY / window.innerHeight) * 0.7;
      setRimLight(lx, ly);
      if (moveRafId) return;
      moveRafId = requestAnimationFrame(() => {
        moveRafId = 0;
        if (atmo) {
          atmo.style.setProperty("--spec-x", `${lx * 100}%`);
          atmo.style.setProperty("--spec-y", `${ly * 100}%`);
          atmo.style.setProperty("--light-x", `${lx * 100}%`);
        }
        emit();
      });
    };

    paint();
    window.addEventListener("scroll", paint, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (moveRafId) cancelAnimationFrame(moveRafId);
      window.removeEventListener("scroll", paint);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return <div ref={atmoRef} className="atmosphere" aria-hidden />;
}
