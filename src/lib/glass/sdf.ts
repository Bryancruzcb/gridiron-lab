/** Rounded-rect SDF. p is centered; b is half-size; r is corner radius. */
export function sdRoundedBox(px: number, py: number, bx: number, by: number, r: number): number {
  const ax = Math.abs(px) - bx + r;
  const ay = Math.abs(py) - by + r;
  const qx = Math.max(ax, 0);
  const qy = Math.max(ay, 0);
  return Math.min(Math.max(ax, ay), 0) + Math.hypot(qx, qy) - r;
}

export function bevelPx(w: number, h: number): number {
  return Math.min(28, Math.max(10, 0.08 * Math.min(w, h)));
}

export function blurPx(w: number): number {
  return Math.min(32, Math.max(16, w / 40));
}

export function displacementScale(bevel: number): number {
  return Math.min(48, Math.max(14, bevel * 1.35));
}
