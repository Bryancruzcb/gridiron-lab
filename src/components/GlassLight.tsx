import { useEffect, useRef } from "react";
import { setRimLight } from "@/lib/glass/rim";

/** Resting positions of the glows in styles.css (.atmosphere-light / .atmosphere-spec), as viewport fractions. */
const LIGHT_REST = { x: 0.22, y: 0.14 };
const SPEC_REST = { x: 0.5, y: 0.08 };

/**
 * One light source for every glass panel — follows scroll and pointer, like iOS.
 * The glows move by transform on their own layers, so scrolling never repaints the wash.
 */
export function GlassLight() {
  const lightRef = useRef<HTMLDivElement | null>(null);
  const specRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const light = { x: 0.2, y: 0.12 };
    const spec = { x: SPEC_REST.x, y: SPEC_REST.y };

    const place = (el: HTMLDivElement | null, pos: { x: number; y: number }, rest: { x: number; y: number }) => {
      if (!el) return;
      const dx = (pos.x - rest.x) * window.innerWidth;
      const dy = (pos.y - rest.y) * window.innerHeight;
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    };

    let rafId = 0;
    const paint = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        const t = window.scrollY / max;
        light.x = 0.2 + t * 0.28;
        light.y = 0.12 + t * 0.68;
        place(lightRef.current, light, LIGHT_REST);
        place(specRef.current, spec, SPEC_REST);
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
        light.x = lx;
        spec.x = lx;
        spec.y = ly;
        place(lightRef.current, light, LIGHT_REST);
        place(specRef.current, spec, SPEC_REST);
        document.documentElement.dispatchEvent(new Event("glasslight"));
      });
    };

    paint();
    window.addEventListener("scroll", paint, { passive: true });
    window.addEventListener("resize", paint, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (moveRafId) cancelAnimationFrame(moveRafId);
      window.removeEventListener("scroll", paint);
      window.removeEventListener("resize", paint);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div className="atmosphere" aria-hidden>
      <div ref={specRef} className="atmosphere-spec" />
      <div ref={lightRef} className="atmosphere-light" />
    </div>
  );
}
