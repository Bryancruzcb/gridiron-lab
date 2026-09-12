import { useEffect, useId, useRef, type ElementType, type ReactNode } from "react";
import { prefersReducedMotion, supportsBackdropUrl, supportsWebGL } from "@/lib/glass/detect";
import { bakeMap } from "@/lib/glass/map";
import { createRim, type Rim } from "@/lib/glass/rim";
import { blurPx } from "@/lib/glass/sdf";
import { removeLens, upsertLens } from "@/lib/glass/svg-lens";
import { cn } from "@/lib/utils";

export function LiquidChrome({
  as: Tag = "div",
  className,
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  const rawId = useId().replace(/:/g, "");
  const filterId = `lg-${rawId}`;
  const ref = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    const canvas = canvasRef.current;
    if (!node) return;

    const reduced = prefersReducedMotion();
    const useSvg = supportsBackdropUrl() && !reduced;
    const useGl = supportsWebGL() && !reduced;
    let rim: Rim | null = null;
    let t = 0;
    let lastKey = "";

    if (useGl && canvas) rim = createRim(canvas);
    else if (canvas) canvas.hidden = true;

    const apply = () => {
      const rect = node.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      if (w < 8 || h < 8) return;
      const radius = Number.parseFloat(getComputedStyle(node).borderTopLeftRadius) || 0;
      const key = `${Math.round(w)}x${Math.round(h)}r${Math.round(radius)}`;
      const blur = blurPx(w);
      node.style.setProperty("--lg-blur", `${blur}px`);

      if (key !== lastKey) {
        lastKey = key;
        const map = bakeMap(w, h, radius);
        if (map && useSvg) {
          upsertLens(filterId, map.url, map.scale, map.width, map.height);
          const lens = `blur(${blur}px) saturate(1.7) url(#${filterId})`;
          node.style.backdropFilter = lens;
          (node.style as CSSStyleDeclaration & { webkitBackdropFilter: string }).webkitBackdropFilter = lens;
        } else {
          const frost = `blur(${blur}px) saturate(1.7)`;
          node.style.backdropFilter = frost;
          (node.style as CSSStyleDeclaration & { webkitBackdropFilter: string }).webkitBackdropFilter = frost;
        }
        rim?.resize(w, h, radius, map?.bevel ?? 16);
      } else {
        rim?.dirty();
      }
    };

    const onLight = () => {
      rim?.dirty();
    };

    apply();
    const ro = new ResizeObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(apply, 80);
    });
    ro.observe(node);
    window.addEventListener("glasslight", onLight);
    window.addEventListener("resize", apply);

    return () => {
      window.clearTimeout(t);
      ro.disconnect();
      window.removeEventListener("glasslight", onLight);
      window.removeEventListener("resize", apply);
      rim?.destroy();
      removeLens(filterId);
    };
  }, [filterId]);

  return (
    <Tag ref={ref as never} className={cn("liquid-chrome relative", className)}>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
        aria-hidden
      />
      <div className="relative z-[2]">{children}</div>
    </Tag>
  );
}
