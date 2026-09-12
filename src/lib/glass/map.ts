import { bevelPx, sdRoundedBox } from "./sdf";

export type LensMap = {
  canvas: HTMLCanvasElement;
  url: string;
  bevel: number;
  scale: number;
  radius: number;
  width: number;
  height: number;
};

function encode(v: number): number {
  return Math.max(0, Math.min(255, Math.round(128 + v)));
}

/** Bake RG displacement + B rim mask from the element's real box. Not a stock PNG. */
export function bakeMap(w: number, h: number, radius: number): LensMap | null {
  const width = Math.max(1, Math.round(w));
  const height = Math.max(1, Math.round(h));
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  const bevel = bevelPx(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const img = ctx.createImageData(width, height);
  const data = img.data;
  const hx = width / 2;
  const hy = height / 2;
  const strength = bevel * 0.85;
  const e = 1.25;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const px = x + 0.5 - hx;
      const py = y + 0.5 - hy;
      const d = sdRoundedBox(px, py, hx, hy, r);
      const i = (y * width + x) * 4;
      if (d > 1) {
        data[i] = 128;
        data[i + 1] = 128;
        data[i + 2] = 0;
        data[i + 3] = 255;
        continue;
      }
      const inner = Math.max(0, -d);
      const t = 1 - Math.min(1, inner / bevel);
      const dx =
        sdRoundedBox(px + e, py, hx, hy, r) - sdRoundedBox(px - e, py, hx, hy, r);
      const dy =
        sdRoundedBox(px, py + e, hx, hy, r) - sdRoundedBox(px, py - e, hx, hy, r);
      const len = Math.hypot(dx, dy) || 1;
      const ox = (dx / len) * t * strength;
      const oy = (dy / len) * t * strength;
      data[i] = encode(ox);
      data[i + 1] = encode(oy);
      data[i + 2] = Math.round(t * 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL("image/png");
  return { canvas, url, bevel, scale: Math.min(48, Math.max(14, bevel * 1.35)), radius: r, width, height };
}
